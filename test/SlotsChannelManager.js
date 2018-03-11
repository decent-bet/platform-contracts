const BigNumber = require('bignumber.js')
const SHA256 = require('crypto-js/sha256')
const AES = require('crypto-js/aes')
const seedRandom = require('seedrandom')

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

// Constants

const NUMBER_OF_REELS = 5

let generateRandomNumber = length => {
    return Math.floor(
        Math.pow(10, length - 1) + Math.random() * 9 * Math.pow(10, length - 1)
    )
}

let getAesKey = (id, privateKey) => {
    return new Promise((resolve, reject) => {
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
                let initialUserNumber = AES.encrypt(
                    randomNumber,
                    res
                ).toString()
                let userHashes = getUserHashes(randomNumber)
                let finalUserHash = userHashes[userHashes.length - 1]
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
        let channelDepositParams = await getChannelDepositParams(
            channelId,
            nonFounderPrivateKey
        )
        console.log('Channel Deposit Params', channelDepositParams)

        initialUserNumber = channelDepositParams.initialUserNumber
        finalUserHash = channelDepositParams.finalUserHash

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
                        hashes.push(
                            SHA256(i === 0 ? seed : hashes[i - 1]).toString()
                        )
                    return hashes
                },
                reels: reelSeedHashes => {
                    console.log('Reels')
                    let reels = []
                    for (let i = 0; i < reelSeedHashes.length; i++) {
                        let hash = reelSeedHashes[i]
                        let reel = []
                        for (let j = 0; j < NUMBER_OF_REELS; j++) {
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
                            SHA256(
                                reelSeedHashes[i] + reels[i].toString()
                            ).toString()
                        )
                    return reelHashes
                }
            }
        }

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
            let initialDeposit = channelInfo[4]

            let contractBalancePostActivation = await slotsChannelManager.balanceOf(
                slotsChannelManager.address,
                currentSession
            )

            console.log(
                'Contract balances',
                contractBalancePreActivation.toFixed(),
                contractBalancePostActivation.toFixed(),
                initialDeposit.toFixed()
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
            throw new Error(e)
        }
    })

    it('disallows authorized addresses from activating a channel if already activated', async () => {})

    it('disallows non participants from finalizing a channel', async () => {})

    it('disallows participants from finalizing a channel with invalid data', async () => {})

    it('disallows participants from claiming a channel before it closes', async () => {})

    it('allows participants to close a channel with valid data', async () => {})

    it('allows participants to claim a channel after it closes', async () => {})
})
