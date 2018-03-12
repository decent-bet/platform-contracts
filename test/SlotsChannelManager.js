const BigNumber = require('bignumber.js')
const SHA256 = require('crypto-js/sha256')
const AES = require('crypto-js/aes')
const seedRandom = require('seedrandom')
const ethUnits = require('ethereum-units')
const ethUtil = require('ethereumjs-util')

let utils = require('./utils/utils.js')

let MultiSigWallet = artifacts.require('MultiSigWallet')
let DecentBetToken = artifacts.require('TestDecentBetToken')
let House = artifacts.require('House')
let HouseLottery = artifacts.require('HouseLottery')
let BettingProvider = artifacts.require('BettingProvider')
let BettingProviderHelper = artifacts.require('BettingProviderHelper')
let SportsOracle = artifacts.require('SportsOracle')
let SlotsChannelManager = artifacts.require('SlotsChannelManager')

let wallet
let token
let house

let slotsChannelManager
let bettingProvider
let sportsOracle

let founder
let nonFounder
let nonInvestor

let nonFounderPrivateKey =
    '0x5c7f17702c636b560743b0dcb1b1d2b18e64de0667010ca4d9cac4f7119d0428'
let housePrivateKey =
    '0xf670adee34d38fc203ff707d7e7ef8946a6bb74fffdfc8d1a44c1e63eae86141'

let channelId

// User deposit params
let initialUserNumber
let finalUserHash

// House channel params
let initialHouseSeed
let initialHouseSeedHash
let finalSeedHash
let finalReelHash
let reelsAndHashes

// User Channel State
let houseSpins = []
let userSpins = []
let userHashes
let nonce = 1
let initialDeposit
let channelAesKey

// House Channel State
let dbChannel
let spins = []

// Constants
const constants = require('./utils/constants')

let getNewDbChannel = (
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

let generateRandomNumber = length => {
    return Math.floor(
        Math.pow(10, length - 1) + Math.random() * 9 * Math.pow(10, length - 1)
    )
}

let getAesKey = (id, privateKey) => {
    return new Promise(resolve => {
        let idHash = utils.getWeb3().utils.sha3(id)
        let aesKey = utils
            .getWeb3()
            .eth.accounts.sign(
                utils.getWeb3().utils.utf8ToHex(idHash),
                privateKey
            ).signature
        console.log('Retrieved aes key', aesKey)
        resolve(aesKey)
    })
}

let getUserHashes = randomNumber => {
    let lastHash
    let hashes = []
    for (let i = 0; i < 1000; i++) {
        let hash = SHA256(i === 0 ? randomNumber : lastHash).toString()
        hashes.push(hash)
        lastHash = hash
    }
    return hashes
}

let getChannelDepositParams = (id, key) => {
    return new Promise((resolve, reject) => {
        let randomNumber = generateRandomNumber(18).toString()
        getAesKey(id, key)
            .then(res => {
                console.log('randomNumber', randomNumber, 'aesKey', res)
                channelAesKey = key
                initialUserNumber = AES.encrypt(randomNumber, res).toString()
                userHashes = getUserHashes(randomNumber)
                finalUserHash = userHashes[userHashes.length - 1]
                resolve({
                    initialUserNumber: initialUserNumber,
                    finalUserHash: finalUserHash
                })
            })
            .catch(err => {
                reject(err)
            })
    })
}

let getTightlyPackedSpin = spin => {
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

let signString = (text, address, key) => {
    return new Promise((resolve, reject) => {
        /*
         * Sign a string and return (hash, v, r, s) used by ecrecover to regenerate the user's address;
         */
        try {
            let msgHash = ethUtil.sha3(text)
            let privateKey = ethUtil.toBuffer(key)

            console.log(
                'Signing',
                text,
                ethUtil.bufferToHex(msgHash),
                'as',
                address,
                ethUtil.isValidPrivate(privateKey)
            )

            const { v, r, s } = ethUtil.ecsign(msgHash, privateKey)
            const sgn = ethUtil.toRpcSig(v, r, s)

            console.log(
                'v: ' +
                    v +
                    ', r: ' +
                    sgn.slice(0, 66) +
                    ', s: ' +
                    '0x' +
                    sgn.slice(66, 130)
            )

            let m = ethUtil.toBuffer(msgHash)
            let pub = ethUtil.ecrecover(m, v, r, s)
            let adr = '0x' + ethUtil.pubToAddress(pub).toString('hex')

            console.log('Generated sign address', adr, address)
            console.log('Generated msgHash', msgHash, 'Sign', sgn)

            let nonChecksummedAddress = address.toLowerCase()

            if (adr !== nonChecksummedAddress)
                throw new Error('Invalid address for signed message')

            resolve({
                msgHash: msgHash,
                sig: sgn
            })
        } catch (e) {
            reject(e)
        }
    })
}

let getSpin = async (betSize, address, key) => {
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

    let sign = await signString(getTightlyPackedSpin(spin), address, key)
    return new Promise(resolve => {
        spin.sign = sign.sig
        resolve(spin)
    })
}
let generateReelsAndHashes = (initialHouseSeed, id) => {
    let blendedSeed = initialHouseSeed + id
    let reelSeedHashes = generator().reelSeedHashes(blendedSeed)
    let reels = generator().reels(reelSeedHashes)
    let reelHashes = generator().reelHashes(reelSeedHashes, reels)

    console.log(
        'generateReelsAndHashes',
        blendedSeed,
        reelSeedHashes[reelSeedHashes.length - 1],
        reelHashes[reelHashes.length - 1]
    )
    return {
        reelSeedHashes: reelSeedHashes,
        reels: reels,
        reelHashes: reelHashes
    }
}

let generator = () => {
    return {
        reelSeedHashes: seed => {
            console.log('Reel seed hashes')
            let hashes = []
            for (let i = 0; i < 1000; i++)
                hashes.push(SHA256(i === 0 ? seed : hashes[i - 1]).toString())
            return hashes
        },
        reels: reelSeedHashes => {
            console.log('Reels')
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
        },
        reelHashes: (reelSeedHashes, reels) => {
            console.log('Reel hashes')
            let reelHashes = []
            for (let i = 0; i < reelSeedHashes.length; i++)
                reelHashes.push(
                    SHA256(reelSeedHashes[i] + reels[i].toString()).toString()
                )
            return reelHashes
        }
    }
}

let getEtherInWei = () => {
    return ethUnits.units.ether
}

let convertToEther = number => {
    return new BigNumber(number).times(getEtherInWei()).toFixed(0)
}

/**
 * Calculates payouts for a given reel based on betsize
 * @param reel
 * @param betSize
 * @returns {number}
 */
let calculateReelPayout = (reel, betSize) => {
    betSize = utils.getWeb3().utils.fromWei(betSize.toString(), 'ether')
    let isValid = true
    for (let i = 0; i < reel.length; i++) {
        if (reel[i] > 20) {
            isValid = false
            break
        }
    }
    if (!isValid) return 0
    let lines = getLines(reel)
    let totalReward = 0
    for (let i = 0; i < betSize; i++)
        totalReward += getLineRewardMultiplier(lines[i])
    return totalReward
}

/**
 * Returns the reward multiplier based on the current line
 * @param line
 * @returns {number}
 */
let getLineRewardMultiplier = line => {
    let repetitions = 1
    let rewardMultiplier = 0
    for (let i = 1; i <= line.length; i++) {
        if (line[i] === line[i - 1]) repetitions++
        else break
    }
    if (repetitions >= 3) {
        rewardMultiplier = PAYTABLE[line[0]] * (repetitions - 2)
    }
    return rewardMultiplier
}

/**
 * Returns lines for the submitted reel.
 * @param reel
 * @returns {Array}
 */
// Returns NUMBER_OF_LINES lines containing constants.NUMBER_OF_REELS symbols each
let getLines = reel => {
    let lines = []
    for (let i = 0; i < constants.NUMBER_OF_LINES; i++) {
        lines.push(getLine(i, reel))
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
let getLine = (lineIndex, reel) => {
    let line = []
    switch (lineIndex) {
        case 0:
            for (let i = 0; i < constants.NUMBER_OF_REELS; i++) {
                line[i] = getSymbol(i, reel[i])
            }
            break
        case 1:
            for (let i = 0; i < constants.NUMBER_OF_REELS; i++) {
                line[i] = getSymbol(i, reel[i] - 1)
            }
            break
        case 2:
            for (let i = 0; i < constants.NUMBER_OF_REELS; i++) {
                line[i] = getSymbol(i, reel[i] + 1)
            }
            break
        case 3:
            for (let i = 0; i < constants.NUMBER_OF_REELS; i++) {
                if (i === 0 || i === 4) line[i] = getSymbol(i, reel[i] - 1)
                else if (i === 2) line[i] = getSymbol(i, reel[i] + 1)
                else line[i] = getSymbol(i, reel[i])
            }
            break
        case 4:
            for (let i = 0; i < constants.NUMBER_OF_REELS; i++) {
                if (i === 0 || i === 4) line[i] = getSymbol(i, reel[i] + 1)
                else if (i === 2) line[i] = getSymbol(i, reel[i] - 1)
                else line[i] = getSymbol(i, reel[i])
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
let getSymbol = (reel, position) => {
    if (position === 21) position = 0
    else if (position === -1) position = 20
    return constants.reels[reel][position]
}

let processSpin = async (id, spin, encryptedSpin) => {
    let aesKey = await getAesKey(finalUserHash, housePrivateKey)

    // Check if the channel is active
    let isChannelFinalized = () => {
        return (
            dbChannel.player.finalized.status ||
            dbChannel.house.finalized.status
        )
    }

    let isChannelClosed = () => {
        return dbChannel.closed
    }

    // Check if balances are empty
    let isChannelBalancesEmpty = () => {
        const lastHouseSpin =
            houseSpins.length > 0 ? houseSpins[houseSpins.length - 1] : null
        // No house spins available yet, balance cannot be empty
        if (!lastHouseSpin) return false
        let nonce = lastHouseSpin.nonce
        let spin = lastHouseSpin.spin
        return nonce > 0 && (spin.userBalance === 0 || spin.houseBalance === 0)
    }

    // Verify the sign
    let verifySign = async () => {
        let nonSignatureSpin = JSON.parse(JSON.stringify(spin))
        delete nonSignatureSpin.sign

        let id = parseInt(dbChannel.id)
        let msg = getTightlyPackedSpin(nonSignatureSpin)
        let msgHash = utils.getWeb3().utils.sha3(msg)
        let sign = spin.sign

        return await slotsChannelManager.checkSig(id, msgHash, sign, spin.turn)
    }

    // Get previous spins
    let getPreviousSpins = () => {
        let nonce = spin.nonce

        if (nonce <= 1)
            return {
                playerSpin: null,
                houseSpin: null,
                nonce: nonce
            }
        else {
            return {
                playerSpin: userSpins[userSpins.length - nonce],
                houseSpin: houseSpins[houseSpins.length - nonce]
            }
        }
    }

    // Verify the spin
    let verifySpin = async () => {
        let nonce = dbChannel.nonce
        if (nonce !== spin.nonce - 1 || spin.nonce > 1000) return false
        else {
            let previousSpins = getPreviousSpins()
            return (validateBetSize() && verifyBalances(previousSpins) && verifyHashes(previousSpins))
        }
    }

    let validateBetSize = () => {
        let betSize = new BigNumber(spin.betSize)
        const maxBet = utils.getWeb3().utils.toWei('5', 'ether')
        const minBet = utils.getWeb3().utils.toWei('0.01', 'ether')
        return betSize.greaterThan(maxBet) || betSize.lessThan(minBet)
    }

    let verifyBalances = previousSpins => {
        if (spin.nonce > 1) {
            let prevHouseSpin = previousSpins.house.spin
            return (
                spin.userBalance !== prevHouseSpin.userBalance ||
                spin.houseBalance !== prevHouseSpin.houseBalance
            )
        } else {
            return (
                spin.userBalance !== dbChannel.initialDeposit ||
                spin.houseBalance !== dbChannel.initialDeposit
            )
        }
    }

    let verifyHashes = previousSpins => {
        let reelHashes = reelsAndHashes.reelHashes
        let reelSeedHashes = reelsAndHashes.reelSeedHashes

        if (spin.nonce > 1) {
            let prevPlayerSpin = previousSpins.player.spin
            if (spin.userHash !== prevPlayerSpin.prevUserHash) return false
            else if (sha256(spin.prevUserHash).toString() !== spin.userHash)
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
            else if (
                reelSeedHashes[reelSeedHashes.length - spin.nonce] !==
                spin.prevReelSeedHash
            )
                return false
            else return true
        } else {
            if (SHA256(spin.prevUserHash).toString() !== spin.userHash)
                return false
            else if (
                reelHashes[reelHashes.length - spin.nonce] !== spin.reelHash
            )
                return false
            else if (
                reelSeedHashes[reelSeedHashes.length - spin.nonce] !==
                spin.reelSeedHash
            )
                return false
            else {
                return true
            }
        }
    }

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
                calculateReelPayout(reel, spin.betSize).toString(),
                'ether'
            )
        let userBalance =
            payout === 0
                ? new BigNumber(spin.userBalance).minus(spin.betSize)
                : new BigNumber(spin.userBalance)
                      .add(payout)
                      .minus(spin.betSize)
        let houseBalance =
            payout === 0
                ? new BigNumber(spin.houseBalance).add(spin.betSize)
                : new BigNumber(spin.houseBalance)
                      .minus(payout)
                      .add(spin.betSize)

        // Balances below 0 should be corrected to 0 to ensure no party receives more tokens than
        // what is available in the created channel.
        if (userBalance.lessThanOrEqualTo(0)) {
            houseBalance = houseBalance.add(userBalance)
            userBalance = new BigNumber(0)
        } else if (houseBalance.lessThanOrEqualTo(0)) {
            userBalance = userBalance.add(houseBalance)
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

        let tightlyPackedSpin = getTightlyPackedSpin(houseSpin)

        console.log(
            'Tightly packed spin'.info,
            JSON.stringify(tightlyPackedSpin).debug
        )

        houseSpin.sign = await signString(
            tightlyPackedSpin,
            founder,
            housePrivateKey
        )
        return houseSpin
    }

    let saveSpin = async () => {
        let houseSpin = await getHouseSpin()
        let houseEncryptedSpin = AES
            .encrypt(JSON.stringify(houseSpin), aesKey)
            .toString()
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

        console.log('saveSpin', spins)
    }

    console.log('Process spin', id)

    if (isChannelFinalized()) return new Error('Channel already finalized')
    console.log('Channel not finalized')

    if (isChannelClosed()) return new Error('Channel already closed')
    console.log('Channel not closed')

    if (isChannelBalancesEmpty()) return new Error('Channel balances are empty')
    console.log('Channel balances not empty')

    if (!await verifySign()) return new Error('Unable to verify sign')
    console.log('Sign verified')

    if (!await verifySpin()) return new Error('Unable to verify spin')
    console.log('Spin verified')

    await saveSpin()
    return true
}

contract('SlotsChannelManager', accounts => {
    it('initializes house contract', async () => {
        founder = accounts[0]
        nonFounder = accounts[1]
        nonInvestor = accounts[2]

        wallet = await MultiSigWallet.deployed()
        token = await DecentBetToken.deployed()
        house = await House.deployed()
        bettingProvider = await BettingProvider.deployed()
        sportsOracle = await SportsOracle.deployed()
        slotsChannelManager = await SlotsChannelManager.deployed()

        // Check if house founder is valid
        let _founder = await house.founder()
        assert.equal(founder, _founder, 'Invalid founder')

        // Check if house token is correct DBET token
        let houseToken = await house.decentBetToken()
        assert.equal(
            token.address,
            houseToken,
            'Invalid token address in house'
        )

        // Begin session zero
        await house.beginNextSession()

        // Allocate 50% of tokens to both offerings
        await house.allocateTokensForHouseOffering(50, bettingProvider.address)
        await house.allocateTokensForHouseOffering(
            50,
            slotsChannelManager.address
        )

        // Redeem the owner faucet
        await token.ownerFaucet()

        // Approve and purchase credits
        const houseCreditsAmount = '50000000000000000000000000'
        await token.approve(house.address, houseCreditsAmount, {
            from: founder
        })
        await house.purchaseCredits(houseCreditsAmount, { from: founder })

        // Deposit allocated tokens in the final week of session zero
        const nextWeek = new Date().getTime() / 1000 + 7 * 24 * 60 * 60 + 1
        await house.setTime(nextWeek, { from: founder })

        await house.depositAllocatedTokensToHouseOffering(
            bettingProvider.address,
            { from: founder }
        )
        await house.depositAllocatedTokensToHouseOffering(
            slotsChannelManager.address,
            { from: founder }
        )

        // Begin session one
        const sessionOneTime =
            new Date().getTime() / 1000 + 14 * 24 * 60 * 60 + 1
        await house.setTime(sessionOneTime, { from: founder })
        await house.beginNextSession()

        // Check if house session is one
        let currentSession = await house.currentSession()
        currentSession = currentSession.toNumber()
        assert.equal(currentSession, 1, 'Invalid current session number')

        // Check if first offering is BettingProvider
        let firstOffering = await house.offeringAddresses(0)
        assert.equal(
            bettingProvider.address,
            firstOffering,
            'Invalid betting provider offering address'
        )

        // Check if second offering is SlotsChannelManager
        let secondOffering = await house.offeringAddresses(1)
        assert.equal(
            slotsChannelManager.address,
            secondOffering,
            'Invalid slots channel manager offering address'
        )

        // Check if deposited amounts for slots and betting provider are correct
        let depositedAmount = new BigNumber(houseCreditsAmount)
            .dividedBy(2)
            .toFixed()

        let slotsDeposit = await slotsChannelManager.balanceOf(
            slotsChannelManager.address,
            currentSession
        )
        let bettingProviderDeposit = await bettingProvider.balanceOf(
            bettingProvider.address,
            currentSession
        )

        assert.equal(
            slotsDeposit.toFixed(),
            depositedAmount,
            'Invalid slots deposit amount'
        )

        assert.equal(
            bettingProviderDeposit.toFixed(),
            depositedAmount,
            'Invalid betting provider deposit amount'
        )

        let bettingProviderSession = await bettingProvider.currentSession()
        let slotsChannelManagerSession = await slotsChannelManager.currentSession()

        assert.equal(
            bettingProviderSession.toNumber(),
            1,
            'Invalid betting provider session'
        )
        assert.equal(
            slotsChannelManagerSession.toNumber(),
            1,
            'Invalid slots channel manager session'
        )
    })

    it('disallows users from depositing without sufficient deposited token balance', async () => {
        await token.faucet({ from: nonFounder })
        let tokenBalance = await token.balanceOf(nonFounder)

        await utils.assertFail(
            slotsChannelManager.deposit.sendTransaction(
                tokenBalance.toFixed() + 1,
                {
                    from: nonFounder
                }
            )
        )
    })

    it('allows users to deposit if deposited token balance is sufficient', async () => {
        let tokenBalance = await token.balanceOf(nonFounder)

        await token.approve(
            slotsChannelManager.address,
            tokenBalance.toFixed(),
            { from: nonFounder }
        )

        await slotsChannelManager.deposit.sendTransaction(
            tokenBalance.toFixed(),
            {
                from: nonFounder
            }
        )
    })

    it('disallows users from creating channels out of hardcoded initial deposit range', async () => {
        let outOfHigherRange = '1001000000000000000000'
        let outOfLowerRange = '99000000000000000000'

        await utils.assertFail(
            slotsChannelManager.createChannel.sendTransaction(
                outOfHigherRange,
                {
                    from: nonFounder
                }
            )
        )

        await utils.assertFail(
            slotsChannelManager.createChannel.sendTransaction(outOfLowerRange, {
                from: nonFounder
            })
        )
    })

    it('disallows users from creating channels without a sufficient deposited token balance', async () => {
        let initialDeposit = '500000000000000000000'

        await utils.assertFail(
            slotsChannelManager.createChannel.sendTransaction(initialDeposit, {
                from: nonInvestor
            })
        )
    })

    it('allows users to create channels with a sufficient balance', async () => {
        let initialDeposit = '500000000000000000000'

        await slotsChannelManager.createChannel.sendTransaction(
            initialDeposit,
            {
                from: nonFounder
            }
        )

        let channelCount = await slotsChannelManager.channelCount()
        channelId = (channelCount.toNumber() - 1).toString()
    })

    it('disallows transferTokensToChannel call from outside contract', async () => {
        assert.equal(
            slotsChannelManager.transferTokensToChannel,
            undefined,
            'transferTokensToChannel must be inaccessible from contract instance'
        )
    })

    it('disallows non players from depositing in channels', async () => {
        let initialUserNumber = 1
        let finalUserHash = 'abc'
        await utils.assertFail(
            slotsChannelManager.depositChannel.sendTransaction(
                channelId,
                initialUserNumber,
                finalUserHash,
                { from: nonInvestor }
            )
        )
    })

    it('disallows players from depositing in channels with invalid data if not ready', async () => {
        initialUserNumber = 1
        finalUserHash = 'abc'
        await utils.assertFail(
            slotsChannelManager.depositChannel.sendTransaction(
                channelId,
                initialUserNumber,
                finalUserHash,
                { from: nonFounder }
            )
        )
    })

    it('disallows authorized addresses from activating a channel when the user is not ready', async () => {
        initialHouseSeedHash = '1'
        finalSeedHash = 'abc'
        finalReelHash = 'def'

        await utils.assertFail(
            slotsChannelManager.activateChannel.sendTransaction(
                channelId,
                initialHouseSeedHash,
                finalSeedHash,
                finalReelHash,
                { from: nonFounder }
            )
        )
    })

    it('allows players to deposit in channels with valid data if not ready', async () => {
        await getChannelDepositParams(channelId, nonFounderPrivateKey)

        console.log('Channel deposit params', initialUserNumber, finalUserHash)
        slotsChannelManager.depositChannel.sendTransaction(
            channelId,
            initialUserNumber,
            finalUserHash,
            { from: nonFounder }
        )

        let channelInfo = await slotsChannelManager.getChannelInfo(channelId)
        let ready = channelInfo[1]

        assert.equal(
            ready,
            true,
            'Player is not ready after depositing in channel'
        )
    })

    it('disallows players from depositing in channels if ready', async () => {
        await utils.assertFail(
            slotsChannelManager.depositChannel.sendTransaction(
                channelId,
                initialUserNumber,
                finalUserHash,
                { from: nonFounder }
            )
        )
    })

    it('disallows unauthorized addresses from activating a channel', async () => {
        initialHouseSeedHash = '1'
        finalSeedHash = 'abc'
        finalReelHash = 'def'

        await utils.assertFail(
            slotsChannelManager.activateChannel.sendTransaction(
                channelId,
                initialHouseSeedHash,
                finalSeedHash,
                finalReelHash,
                { from: nonFounder }
            )
        )
    })

    it('allows authorized addresses to activate a channel if user is ready', async () => {
        try {
            initialHouseSeed = await getAesKey(finalUserHash, housePrivateKey)
            reelsAndHashes = generateReelsAndHashes(initialHouseSeed, channelId)

            finalSeedHash =
                reelsAndHashes.reelSeedHashes[
                    reelsAndHashes.reelSeedHashes.length - 1
                ]
            finalReelHash =
                reelsAndHashes.reelHashes[reelsAndHashes.reelHashes.length - 1]

            console.log('Reels and hashes', finalSeedHash, finalReelHash)
            initialHouseSeedHash = SHA256(initialHouseSeed).toString()

            console.log(
                'Activating channel',
                channelId,
                initialHouseSeedHash,
                finalSeedHash,
                finalReelHash
            )

            let currentSession = await slotsChannelManager.currentSession()
            currentSession = currentSession.toNumber()

            let contractBalancePreActivation = await slotsChannelManager.balanceOf(
                slotsChannelManager.address,
                currentSession
            )

            await slotsChannelManager.activateChannel.sendTransaction(
                channelId,
                initialHouseSeedHash,
                finalSeedHash,
                finalReelHash,
                { from: founder }
            )
            console.log('Sent activateChannel tx')

            let channelInfo = await slotsChannelManager.getChannelInfo(
                channelId
            )
            let activated = channelInfo[2]
            initialDeposit = channelInfo[4].toFixed()

            let contractBalancePostActivation = await slotsChannelManager.balanceOf(
                slotsChannelManager.address,
                currentSession
            )

            console.log(
                'Contract balances',
                contractBalancePreActivation.toFixed(),
                contractBalancePostActivation.toFixed(),
                initialDeposit
            )

            assert.equal(
                activated,
                true,
                'House is not activated after calling activateChannel()'
            )

            assert.equal(
                contractBalancePreActivation.minus(initialDeposit).toFixed(),
                contractBalancePostActivation.toFixed(),
                'Invalid balance after activating channel'
            )
        } catch (e) {
            throw e
        }
    })

    it('disallows authorized addresses from activating a channel if already activated', async () => {
        await utils.assertFail(
            slotsChannelManager.activateChannel.sendTransaction(
                channelId,
                initialHouseSeedHash,
                finalSeedHash,
                finalReelHash,
                { from: founder }
            )
        )
    })

    it('disallows players to spin with invalid spin data', async () => {
        // Max number of lines
        let betSize = 5

        // User spin
        let spin = await getSpin(betSize, nonFounder, nonFounderPrivateKey)
        let encryptedSpin = AES.encrypt(
            JSON.stringify(spin),
            channelAesKey
        ).toString()
        console.log('Spin', spin, encryptedSpin)

        dbChannel = getNewDbChannel(
            channelId,
            slotsChannelManager.address,
            initialDeposit,
            initialHouseSeed,
            finalUserHash,
            finalReelHash,
            finalSeedHash,
            nonFounder
        )

        await processSpin(channelId, spin, encryptedSpin)
    })

    it('allows players to spin with valid spin data', async () => {})

    it('disallows non participants from finalizing a channel', async () => {})

    it('disallows participants from finalizing a channel with invalid data', async () => {})

    it('disallows participants from claiming a channel before it closes', async () => {})

    it('allows participants to close a channel with valid data', async () => {})

    it('allows participants to claim a channel after it closes', async () => {})
})
