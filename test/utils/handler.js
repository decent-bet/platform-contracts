const utils = require('./utils')
const constants = require('./constants')

const BigNumber = require('bignumber.js')
const SHA256 = require('crypto-js/sha256')
const AES = require('crypto-js/aes')
const seedRandom = require('seedrandom')
const ethUtil = require('ethereumjs-util')

/**
 * Returns a new mock db channel
 * @param id
 * @param contractAddress
 * @param initialDeposit
 * @param initialSeed
 * @param finalUserHash
 * @param finalReelHash
 * @param finalSeedHash
 * @param playerAddress
 * @returns {{id: *, contractAddress: *, deposit: *, nonce: number, initialSeed: *, finalUserHash: *, finalReelHash: *, finalSeedHash: *, player: {address: *, finalized: {status: boolean, timestamp: number}}, house: {finalized: {status: boolean, timestamp: number}}, closed: boolean}}
 */
const getNewDbChannel = (
    id,
    contractAddress,
    initialDeposit,
    initialSeed,
    finalUserHash,
    finalReelHash,
    finalSeedHash,
    playerAddress
) => {
    return {
        id: id,
        contractAddress: contractAddress,
        deposit: initialDeposit,
        nonce: 0,
        initialSeed: initialSeed,
        finalUserHash: finalUserHash,
        finalReelHash: finalReelHash,
        finalSeedHash: finalSeedHash,
        player: {
            address: playerAddress,
            finalized: {
                status: false,
                timestamp: 0
            }
        },
        house: {
            finalized: {
                status: false,
                timestamp: 0
            }
        },
        closed: false
    }
}

/**
 * Generates an AES key based on the slots channel protocol spec
 * @param id
 * @param privateKey
 * @returns {Promise<any>}
 */
const getAesKey = (id, privateKey) => {
    return new Promise(resolve => {
        let idHash = utils.getWeb3().utils.sha3(id)
        let aesKey = utils
            .getWeb3()
            .eth.accounts.sign(
                utils.getWeb3().utils.utf8ToHex(idHash),
                privateKey
            ).signature
        resolve(aesKey)
    })
}

/**
 * Returns channel deposit parameters
 * @param id
 * @param key
 * @returns {Promise<any>}
 */
const getChannelDepositParams = (id, key) => {
    return new Promise((resolve, reject) => {
        let randomNumber = _generateRandomNumber(18).toString()
        getAesKey(id, key)
            .then(res => {
                let channelAesKey = key
                let initialUserNumber = AES.encrypt(
                    randomNumber,
                    res
                ).toString()
                let userHashes = _getUserHashes(randomNumber)
                let finalUserHash = userHashes[userHashes.length - 1]
                resolve({
                    channelAesKey,
                    initialUserNumber,
                    userHashes,
                    finalUserHash
                })
            })
            .catch(err => {
                reject(err)
            })
    })
}

/**
 * Returns a spin based on the current nonce and last house spin
 * @param houseSpins
 * @param nonce
 * @param finalReelHash
 * @param finalSeedHash
 * @param userHashes
 * @param initialDeposit
 * @param betSize
 * @param address
 * @param key
 * @returns {Promise<any>}
 */
const getSpin = async (
    houseSpins,
    nonce,
    finalReelHash,
    finalSeedHash,
    userHashes,
    initialDeposit,
    betSize,
    address,
    key
) => {
    const lastHouseSpin = houseSpins[houseSpins.length - 1]

    let reelHash = nonce === 1 ? finalReelHash : lastHouseSpin.reelHash
    let reel = ''
    let reelSeedHash = nonce === 1 ? finalSeedHash : lastHouseSpin.reelSeedHash
    let prevReelSeedHash = nonce === 1 ? '' : lastHouseSpin.prevReelSeedHash
    let userHash = userHashes[userHashes.length - nonce]
    let prevUserHash = userHashes[userHashes.length - nonce - 1]
    let userBalance = nonce === 1 ? initialDeposit : lastHouseSpin.userBalance
    userBalance = new BigNumber(userBalance).toFixed(0)
    let houseBalance = nonce === 1 ? initialDeposit : lastHouseSpin.houseBalance
    houseBalance = new BigNumber(houseBalance).toFixed(0)

    let spin = {
        reelHash: reelHash,
        reel: reel,
        reelSeedHash: reelSeedHash,
        prevReelSeedHash: prevReelSeedHash,
        userHash: userHash,
        prevUserHash: prevUserHash,
        nonce: nonce,
        turn: false,
        userBalance: userBalance,
        houseBalance: houseBalance,
        betSize: betSize
    }

    let sign = await utils.signString(_getTightlyPackedSpin(spin), address, key)
    return new Promise(resolve => {
        spin.sign = sign.sig
        resolve(spin)
    })
}

/**
 * Generates reels and hashes based on the initial house seed and channel id
 * @param initialHouseSeed
 * @param id
 * @returns {{reelSeedHashes, reels, reelHashes}}
 */
const generateReelsAndHashes = (initialHouseSeed, id) => {
    let blendedSeed = initialHouseSeed + id
    let reelSeedHashes = _generateReelSeedHashes(blendedSeed)
    let reels = _generateReels(reelSeedHashes)
    let reelHashes = _generateReelHashes(reelSeedHashes, reels)

    return {
        reelSeedHashes: reelSeedHashes,
        reels: reels,
        reelHashes: reelHashes
    }
}

/**
 * Processes a spin - verifies, validates and returns house spins
 * @param id
 * @param dbChannel
 * @param founder
 * @param userSpins
 * @param houseSpins
 * @param spins
 * @param finalUserHash
 * @param slotsChannelManager
 * @param reelsAndHashes
 * @param spin
 * @param encryptedSpin
 * @returns {Promise<boolean>}
 */
let processSpin = async (
    id,
    dbChannel,
    founder,
    userSpins,
    houseSpins,
    spins,
    finalUserHash,
    slotsChannelManager,
    reelsAndHashes,
    spin,
    encryptedSpin
) => {
    let aesKey = await getAesKey(finalUserHash, constants.privateKeys.house)

    /**
     * Returns whether the channel has been finalized
     * @returns {boolean}
     */
    let isChannelFinalized = () => {
        return (
            dbChannel.player.finalized.status ||
            dbChannel.house.finalized.status
        )
    }

    /**
     * Returns whether the channel has been closed
     * @returns {boolean}
     */
    let isChannelClosed = () => {
        return dbChannel.closed
    }

    /**
     * Checks if the channel's balances are empty
     * @returns {boolean}
     */
    let isChannelBalancesEmpty = () => {
        const lastHouseSpin =
            houseSpins.length > 0 ? houseSpins[houseSpins.length - 1] : null
        // No house spins available yet, balance cannot be empty
        if (!lastHouseSpin) return false
        let nonce = lastHouseSpin.nonce

        return (
            nonce > 0 &&
            (lastHouseSpin.userBalance === 0 ||
                lastHouseSpin.houseBalance === 0)
        )
    }

    /**
     * Verifies the sign provided with the spin
     * @returns {Promise<*>}
     */
    let verifySign = async () => {
        let nonSignatureSpin = JSON.parse(JSON.stringify(spin))
        delete nonSignatureSpin.sign

        let id = parseInt(dbChannel.id)
        let msg = _getTightlyPackedSpin(nonSignatureSpin)
        let msgHash = utils.getWeb3().utils.sha3(msg)
        let sign = spin.sign

        return await slotsChannelManager.checkSig(id, msgHash, sign, spin.turn)
    }

    /**
     * Returns the last player and house spin
     * @returns {*}
     */
    let getPreviousSpins = () => {
        let nonce = spin.nonce

        if (nonce <= 1)
            return {
                player: null,
                house: null,
                nonce: nonce
            }
        else {
            return {
                player: userSpins[userSpins.length - 1],
                house: houseSpins[houseSpins.length - 1]
            }
        }
    }

    /**
     * Validates and verifies spin data
     * @returns {Promise<boolean>}
     */
    let verifySpin = async () => {
        let nonce = dbChannel.nonce

        if (nonce !== spin.nonce - 1 || spin.nonce > 1000)
            throw new Error('Invalid nonce' + ',' + nonce + ',' + spin.nonce)
        else {
            let previousSpins = getPreviousSpins()

            if (!validateBetSize()) throw new Error('Invalid betSize')

            if (!verifyBalances(previousSpins))
                throw new Error('Invalid balances')

            if (!verifyHashes(previousSpins)) throw new Error('Invalid hashes')

            return true
        }
    }

    /**
     * Validate whether the betSize is between the minimum and maximum betSizes.
     * Valid betsizes are:
     * 0.01 - 0.05 ETH
     * 0.1  - 0.5  ETH
     * 1    - 5    ETH
     * @returns {*}
     */
    let validateBetSize = () => {
        return _getAdjustedBetSize(spin.betSize) !== 0
    }

    /**
     * Verifies balances based on the previous spins
     * @param previousSpins
     * @returns {boolean}
     */
    let verifyBalances = previousSpins => {
        if (spin.nonce > 1) {
            let prevHouseSpin = previousSpins.house
            return (
                spin.userBalance === prevHouseSpin.userBalance &&
                spin.houseBalance === prevHouseSpin.houseBalance
            )
        } else {
            return (
                spin.userBalance === dbChannel.deposit &&
                spin.houseBalance === dbChannel.deposit
            )
        }
    }

    /**
     * Verifies hashes based on the previous spins
     * @param previousSpins
     * @returns {boolean}
     */
    let verifyHashes = previousSpins => {
        let reelHashes = reelsAndHashes.reelHashes
        let reelSeedHashes = reelsAndHashes.reelSeedHashes

        if (spin.nonce > 1) {
            let prevPlayerSpin = previousSpins.player
            if (spin.userHash !== prevPlayerSpin.prevUserHash) return false
            else if (SHA256(spin.prevUserHash).toString() !== spin.userHash)
                return false
            else if (
                reelHashes[reelHashes.length - spin.nonce + 1] !== spin.reelHash
            )
                return false
            else if (
                reelSeedHashes[reelSeedHashes.length - spin.nonce + 1] !==
                spin.reelSeedHash
            )
                return false
            else
                return (
                    reelSeedHashes[reelSeedHashes.length - spin.nonce] ===
                    spin.prevReelSeedHash
                )
        } else {
            if (SHA256(spin.prevUserHash).toString() !== spin.userHash)
                return false
            else if (
                reelHashes[reelHashes.length - spin.nonce] !== spin.reelHash
            )
                return false
            else
                return (
                    reelSeedHashes[reelSeedHashes.length - spin.nonce] ===
                    spin.reelSeedHash
                )
        }
    }

    /**
     * Returns a house spin based on the player spin
     * @returns {Promise<>}
     */
    let getHouseSpin = async () => {
        let nonce = spin.nonce
        let reels = reelsAndHashes.reels
        let reelHashes = reelsAndHashes.reelHashes
        let reelSeedHashes = reelsAndHashes.reelSeedHashes

        let reelHash = reelHashes[reelHashes.length - nonce]
        let reel = reels[reels.length - nonce]

        let payout = utils
            .getWeb3()
            .utils.toWei(
                _calculateReelPayout(reel, spin.betSize).toString(),
                'ether'
            )

        let userBalance =
            payout === 0
                ? new BigNumber(spin.userBalance).minus(spin.betSize)
                : new BigNumber(spin.userBalance)
                      .plus(payout)
                      .minus(spin.betSize)

        let houseBalance =
            payout === 0
                ? new BigNumber(spin.houseBalance).plus(spin.betSize)
                : new BigNumber(spin.houseBalance)
                      .minus(payout)
                      .plus(spin.betSize)

        // Balances below 0 should be corrected to 0 to ensure no party receives more tokens than
        // what is available in the created channel.
        if (userBalance.isLessThanOrEqualTo(0)) {
            houseBalance = houseBalance.plus(userBalance)
            userBalance = new BigNumber(0)
        } else if (houseBalance.isLessThanOrEqualTo(0)) {
            userBalance = userBalance.plus(houseBalance)
            houseBalance = new BigNumber(0)
        }

        userBalance = userBalance.toFixed()
        houseBalance = houseBalance.toFixed()

        let reelSeedHash = reelSeedHashes[reelSeedHashes.length - nonce]
        let prevReelSeedHash = reelSeedHashes[reelSeedHashes.length - 1 - nonce]
        let userHash = spin.userHash
        let prevUserHash = spin.prevUserHash
        let betSize = spin.betSize

        let houseSpin = {
            reelHash: reelHash,
            reel: reel,
            reelSeedHash: reelSeedHash,
            prevReelSeedHash: prevReelSeedHash,
            userHash: userHash,
            prevUserHash: prevUserHash,
            nonce: spin.nonce,
            turn: true,
            userBalance: userBalance,
            houseBalance: houseBalance,
            betSize: betSize
        }

        let tightlyPackedSpin = _getTightlyPackedSpin(houseSpin)

        houseSpin.sign = await utils.signString(
            tightlyPackedSpin,
            founder,
            constants.privateKeys.house
        )
        houseSpin.sign = houseSpin.sign.sig
        return houseSpin
    }

    /**
     * Updates the last house and player spin states
     * @returns {Promise<void>}
     */
    let saveSpin = async () => {
        let houseSpin = await getHouseSpin()
        let houseEncryptedSpin = AES.encrypt(
            JSON.stringify(houseSpin),
            aesKey
        ).toString()
        spins.push({
            id: id,
            contractAddress: slotsChannelManager.address,
            nonce: spin.nonce,
            player: {
                spin: spin,
                encryptedSpin: encryptedSpin
            },
            house: {
                spin: houseSpin,
                encryptedSpin: houseEncryptedSpin
            }
        })

        userSpins.push(spin)
        houseSpins.push(houseSpin)
        dbChannel.nonce++
    }

    if (isChannelFinalized()) throw new Error('Channel already finalized')

    if (isChannelClosed()) throw new Error('Channel already closed')

    if (isChannelBalancesEmpty()) throw new Error('Channel balances are empty')

    if (!await verifySign()) throw new Error('Unable to verify sign')

    if (!await verifySpin()) throw new Error('Unable to verify spin')

    await saveSpin()

    return true
}

const getSpinParts = spin => {
    let sign = spin.sign

    let sigParams = ethUtil.fromRpcSig(sign)

    let r = ethUtil.bufferToHex(sigParams.r)
    let s = ethUtil.bufferToHex(sigParams.s)
    let v = ethUtil.bufferToInt(sigParams.v)

    return {
        parts:
            spin.reelHash +
            '/' +
            (spin.reel !== '' ? spin.reel.toString() : '') +
            '/' +
            spin.reelSeedHash +
            '/' +
            spin.prevReelSeedHash +
            '/' +
            spin.userHash +
            '/' +
            spin.prevUserHash +
            '/' +
            spin.nonce +
            '/' +
            spin.turn +
            '/' +
            spin.userBalance +
            '/' +
            spin.houseBalance +
            '/' +
            spin.betSize +
            '/' +
            v,
        r: r,
        s: s
    }
}

/**
 * Tightly packs a spin object
 * @param spin
 * @returns {string}
 * @private
 */
const _getTightlyPackedSpin = spin => {
    return (
        spin.reelHash +
        (spin.reel !== '' ? spin.reel.toString() : '') +
        spin.reelSeedHash +
        spin.prevReelSeedHash +
        spin.userHash +
        spin.prevUserHash +
        spin.nonce +
        spin.turn +
        spin.userBalance +
        spin.houseBalance +
        spin.betSize
    )
}

/**
 * Calculates payouts for a given reel based on betsize
 * @param reel
 * @param betSize
 * @returns {number}
 */
const _calculateReelPayout = (reel, betSize) => {
    let adjustedBetSize = _getAdjustedBetSize(betSize)
    let isValid = true
    for (let i = 0; i < reel.length; i++) {
        if (reel[i] > 20) {
            isValid = false
            break
        }
    }
    if (!isValid) return 0
    let lines = _getLines(reel)
    let totalReward = 0
    for (let i = 0; i < adjustedBetSize; i++)
        totalReward += _getLineRewardMultiplier(lines[i])
    return totalReward
}

const _getAdjustedBetSize = betSize => {
    let ethBetSize = new BigNumber(betSize)
        .dividedBy(utils.getEthInWei())
        .toNumber()
    let tenthEthBetSize = new BigNumber(betSize)
        .dividedBy(utils.getEthInWei())
        .multipliedBy(10)
        .toNumber()
    let hundredthEthBetSize = new BigNumber(betSize)
        .dividedBy(utils.getEthInWei())
        .multipliedBy(100)
        .toNumber()

    if (ethBetSize <= 5 && ethBetSize >= 1) return ethBetSize
    else if (tenthEthBetSize <= 5 && tenthEthBetSize >= 1)
        return tenthEthBetSize
    else if (hundredthEthBetSize <= 5 && hundredthEthBetSize >= 1)
        return hundredthEthBetSize
    else return 0
}

/**
 * Generates reel seed hashes based on an input seed
 * @param seed
 * @returns {Array}
 * @private
 */
const _generateReelSeedHashes = seed => {
    let hashes = []
    for (let i = 0; i < 1000; i++)
        hashes.push(SHA256(i === 0 ? seed : hashes[i - 1]).toString())
    return hashes
}

/**
 * Generates reels based on input reel seed hashes
 * @param reelSeedHashes
 * @returns {Array}
 * @private
 */
const _generateReels = reelSeedHashes => {
    let reels = []
    for (let i = 0; i < reelSeedHashes.length; i++) {
        let hash = reelSeedHashes[i]
        let reel = []
        for (let j = 0; j < constants.NUMBER_OF_REELS; j++) {
            let rng = seedRandom(hash + j)
            reel.push(Math.floor(rng() * 21))
        }
        reels.push(reel)
    }
    return reels
}

/**
 * Generates reel hashes based on input reelSeedHashes and reels
 * @param reelSeedHashes
 * @param reels
 * @returns {Array}
 * @private
 */
const _generateReelHashes = (reelSeedHashes, reels) => {
    let reelHashes = []
    for (let i = 0; i < reelSeedHashes.length; i++)
        reelHashes.push(
            SHA256(reelSeedHashes[i] + reels[i].toString()).toString()
        )
    return reelHashes
}

/**
 * Generates random numbers based on an input length
 * @param length
 * @returns {number}
 * @private
 */
const _generateRandomNumber = length => {
    return Math.floor(
        Math.pow(10, length - 1) + Math.random() * 9 * Math.pow(10, length - 1)
    )
}

/**
 * Returns user hashes based on an input random number
 * @param randomNumber
 * @returns {Array}
 * @private
 */
const _getUserHashes = randomNumber => {
    let lastHash
    let hashes = []
    for (let i = 0; i < 1000; i++) {
        let hash = SHA256(i === 0 ? randomNumber : lastHash).toString()
        hashes.push(hash)
        lastHash = hash
    }
    return hashes
}

/**
 * Returns the reward multiplier based on the current line
 * @param line
 * @returns {number}
 */
const _getLineRewardMultiplier = line => {
    let repetitions = 1
    let rewardMultiplier = 0
    for (let i = 1; i <= line.length; i++) {
        if (line[i] === line[i - 1]) repetitions++
        else break
    }
    if (repetitions >= 3) {
        rewardMultiplier = constants.paytable[line[0]] * (repetitions - 2)
    }
    return rewardMultiplier
}

/**
 * Returns lines for the submitted reel.
 * @param reel
 * @returns {Array}
 */
// Returns NUMBER_OF_LINES lines containing constants.NUMBER_OF_REELS symbols each
const _getLines = reel => {
    let lines = []
    for (let i = 0; i < constants.NUMBER_OF_LINES; i++) {
        lines.push(_getLine(i, reel))
    }
    return lines
}

/**
 * Calculates the line for line i based on the submitted reel
 * @param lineIndex
 * @param reel
 * @returns {Array}
 */
// Returns line for an index
const _getLine = (lineIndex, reel) => {
    let line = []
    switch (lineIndex) {
        case 0:
            for (let i = 0; i < constants.NUMBER_OF_REELS; i++) {
                line[i] = _getSymbol(i, reel[i])
            }
            break
        case 1:
            for (let i = 0; i < constants.NUMBER_OF_REELS; i++) {
                line[i] = _getSymbol(i, reel[i] - 1)
            }
            break
        case 2:
            for (let i = 0; i < constants.NUMBER_OF_REELS; i++) {
                line[i] = _getSymbol(i, reel[i] + 1)
            }
            break
        case 3:
            for (let i = 0; i < constants.NUMBER_OF_REELS; i++) {
                if (i === 0 || i === 4) line[i] = _getSymbol(i, reel[i] - 1)
                else if (i === 2) line[i] = _getSymbol(i, reel[i] + 1)
                else line[i] = _getSymbol(i, reel[i])
            }
            break
        case 4:
            for (let i = 0; i < constants.NUMBER_OF_REELS; i++) {
                if (i === 0 || i === 4) line[i] = _getSymbol(i, reel[i] + 1)
                else if (i === 2) line[i] = _getSymbol(i, reel[i] - 1)
                else line[i] = _getSymbol(i, reel[i])
            }
            break
        default:
            break
    }
    return line
}

/**
 * Returns the symbol present for a reel at position
 * @param reel
 * @param position
 * @returns {*}
 */
const _getSymbol = (reel, position) => {
    if (position === 21) position = 0
    else if (position === -1) position = 20
    return constants.reels[reel][position]
}

module.exports = {
    getNewDbChannel,
    getAesKey,
    getChannelDepositParams,
    getSpin,
    generateReelsAndHashes,
    processSpin,
    getSpinParts
}
