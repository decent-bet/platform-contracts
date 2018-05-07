const BigNumber = require('bignumber.js')
const SHA256 = require('crypto-js/sha256')
const AES = require('crypto-js/aes')

// Imports
const utils = require('./utils/utils')
const contracts = require('./utils/contracts')
const handler = require('./utils/handler')
const constants = require('./utils/constants')

let wallet
let token
let house
let houseAuthorizedController
let houseFundsController
let houseSessionsController

let slotsChannelManager
let slotsChannelFinalizer
let slotsHelper
let bettingProvider
let sportsOracle

let founder
let nonFounder
let nonParticipant
let nonKycVerified

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

let isMockTime

const timeTravel = async timeDiff => {
    await utils.timeTravel(timeDiff)
    await mockTimeTravel(timeDiff)
}

const mockTimeTravel = async timeDiff => {
    if (isMockTime) {
        let time = await house.getTime()
        let newTime = time.plus(timeDiff).toNumber()

        return house.setTime(newTime)
    } else return null
}

// Resets channel specific variables to default state
const clearChannelState = () => {
    channelId = ''

    initialUserNumber = ''
    finalUserHash = ''

    initialHouseSeed = ''
    initialHouseSeedHash = ''
    finalSeedHash = ''
    finalReelHash = ''
    reelsAndHashes = ''

    houseSpins = []
    userSpins = []
    userHashes = []
    nonce = 1
    initialDeposit = 0
    channelAesKey = ''

    dbChannel = {}
    spins = []
}

contract('SlotsChannelManager', accounts => {
    it('initializes house contract', async () => {
        founder = accounts[0]
        nonFounder = accounts[1]
        nonParticipant = accounts[2]
        nonKycVerified = accounts[9]

        wallet = await contracts.MultiSigWallet.deployed()
        token = await contracts.DecentBetToken.deployed()
        house = await contracts.House.deployed()
        houseAuthorizedController = await contracts.HouseAuthorizedController.deployed()
        houseFundsController = await contracts.HouseFundsController.deployed()
        houseSessionsController = await contracts.HouseSessionsController.deployed()
        bettingProvider = await contracts.BettingProvider.deployed()
        sportsOracle = await contracts.SportsOracle.deployed()
        slotsChannelManager = await contracts.SlotsChannelManager.deployed()
        slotsChannelFinalizer = await contracts.SlotsChannelFinalizer.deployed()
        slotsHelper = await contracts.SlotsHelper.deployed()

        isMockTime = await house.isMock()

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

        // Redeem the owner faucet
        await token.ownerFaucet()

        // Approve and purchase credits
        const houseCreditsAmount = '50000000000000000000000000'
        await token.approve(house.address, houseCreditsAmount, {
            from: founder
        })

        await house.purchaseCredits(houseCreditsAmount, { from: founder })

        // Deposit allocated tokens in the final week of session zero
        const oneWeek = 7 * 24 * 60 * 60
        await timeTravel(oneWeek)

        // Allocate 50% of tokens to both offerings
        await house.allocateTokensForHouseOffering(
            50,
            bettingProvider.address
        )
        await house.allocateTokensForHouseOffering(
            50,
            slotsChannelManager.address
        )

        // Finalize Token allocations
        await house.finalizeTokenAllocations()

        // Deposit allocated tokens to offerings
        await house.depositAllocatedTokensToHouseOffering(
            bettingProvider.address,
            { from: founder }
        )
        await house.depositAllocatedTokensToHouseOffering(
            slotsChannelManager.address,
            { from: founder }
        )

        // Begin session one
        await timeTravel(oneWeek)
        await house.beginNextSession()

        // Check if house session is one
        let currentSession = await house.currentSession()
        currentSession = currentSession.toNumber()
        assert.equal(currentSession, 1, 'Invalid current session number')

        // Check if first offering is BettingProvider
        let firstOffering = await houseSessionsController.offeringAddresses(0)
        assert.equal(
            bettingProvider.address,
            firstOffering,
            'Invalid betting provider offering address'
        )

        // Check if second offering is SlotsChannelManager
        let secondOffering = await houseSessionsController.offeringAddresses(1)
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
            slotsChannelManager.deposit(tokenBalance.toFixed() + 1, {
                from: nonFounder
            })
        )
    })

    it('allows users to deposit if deposited token balance is sufficient', async () => {
        let tokenBalance = await token.balanceOf(nonFounder)

        await token.approve(
            slotsChannelManager.address,
            tokenBalance.toFixed(),
            { from: nonFounder }
        )

        await slotsChannelManager.deposit(tokenBalance.toFixed(), {
            from: nonFounder
        })
    })

    it('disallows users from creating channels out of hardcoded initial deposit range', async () => {
        let outOfHigherRange = '5001000000000000000000'
        let outOfLowerRange = '4900000000000000000'

        await utils.assertFail(
            slotsChannelManager.createChannel(outOfHigherRange, {
                from: nonFounder
            })
        )

        await utils.assertFail(
            slotsChannelManager.createChannel(outOfLowerRange, {
                from: nonFounder
            })
        )
    })

    it('disallows users from creating channels without a sufficient deposited token balance', async () => {
        let initialDeposit = '500000000000000000000'

        await utils.assertFail(
            slotsChannelManager.createChannel(initialDeposit, {
                from: nonParticipant
            })
        )
    })

    it('disallows users from creating channels if not kyc verified', async () => {
        let initialDeposit = '500000000000000000000'

        await utils.assertFail(
            slotsChannelManager.createChannel(initialDeposit, {
                from: nonKycVerified
            })
        )
    })

    it('allows users to create channels with a sufficient balance', async () => {
        let initialDeposit = '500000000000000000000'

        let receipt = await slotsChannelManager.createChannel(initialDeposit, {
            from: nonFounder
        })

        channelId = receipt.logs[0].args.id

        let loggedEvent = receipt.logs[0].event
        assert.equal(loggedEvent, 'LogNewChannel', 'New channel not created')
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
            slotsChannelManager.depositChannel(
                channelId,
                initialUserNumber,
                finalUserHash,
                { from: nonParticipant }
            )
        )
    })

    it('disallows players from depositing in channels with invalid data if not ready', async () => {
        initialUserNumber = 1
        finalUserHash = 'abc'
        await utils.assertFail(
            slotsChannelManager.depositChannel(
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
            slotsChannelManager.activateChannel(
                channelId,
                finalSeedHash,
                finalReelHash,
                { from: nonFounder }
            )
        )
    })

    it('allows players to deposit in channels with valid data if not ready', async () => {
        let depositParams = await handler.getChannelDepositParams(
            channelId,
            constants.privateKeys.nonFounder
        )

        channelAesKey = depositParams.channelAesKey
        initialUserNumber = depositParams.initialUserNumber
        userHashes = depositParams.userHashes
        finalUserHash = depositParams.finalUserHash

        console.log('Channel deposit params', initialUserNumber, finalUserHash)
        await slotsChannelManager.depositChannel(
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
            slotsChannelManager.depositChannel(
                channelId,
                initialUserNumber,
                finalUserHash,
                { from: nonFounder }
            )
        )
    })

    it('disallows unauthorized addresses from activating a channel', async () => {
        finalSeedHash = 'abc'
        finalReelHash = 'def'

        await utils.assertFail(
            slotsChannelManager.activateChannel(
                channelId,
                finalSeedHash,
                finalReelHash,
                { from: nonFounder }
            )
        )
    })

    it('allows authorized addresses to activate a channel if user is ready', async () => {
        try {
            initialHouseSeed = await handler.getAesKey(
                finalUserHash,
                constants.privateKeys.house
            )
            reelsAndHashes = handler.generateReelsAndHashes(
                initialHouseSeed,
                channelId
            )

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

            let isAuthorized = await houseAuthorizedController.authorized(
                founder
            )
            console.log('Activate channel - isAuthorized', isAuthorized)

            await slotsChannelManager.activateChannel(
                channelId,
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
            slotsChannelManager.activateChannel(
                channelId,
                finalSeedHash,
                finalReelHash,
                { from: founder }
            )
        )
    })

    it('disallows players to spin with invalid spin data', async () => {
        let validated = true
        // Max number of lines
        let betSize = '5000000000000000000'

        dbChannel = handler.getNewDbChannel(
            channelId,
            slotsChannelManager.address,
            initialDeposit,
            initialHouseSeed,
            finalUserHash,
            finalReelHash,
            finalSeedHash,
            nonFounder
        )

        // User spin
        let spin = await handler.getSpin(
            houseSpins,
            nonce,
            finalReelHash,
            finalSeedHash,
            userHashes,
            initialDeposit,
            betSize,
            nonFounder,
            constants.privateKeys.nonFounder
        )

        Object.keys(spin).forEach(async prop => {
            let _spin = JSON.parse(JSON.stringify(spin))
            _spin[prop] = 'a'

            let encryptedSpin = AES.encrypt(
                JSON.stringify(_spin),
                channelAesKey
            ).toString()

            validated = true
            try {
                await handler.processSpin(
                    channelId,
                    dbChannel,
                    founder,
                    userSpins,
                    houseSpins,
                    spins,
                    finalUserHash,
                    slotsChannelManager,
                    reelsAndHashes,
                    _spin,
                    encryptedSpin
                )
            } catch (e) {
                // Valid result
                validated = false
            }

            assert.equal(validated, false, 'Spin should be invalid')
        })
    })

    it('allows players to spin with valid spin data', async () => {
        // First spin
        let validated = true
        try {
            // Max number of lines
            let betSize = '500000000000000000'

            // User spin
            let spin = await handler.getSpin(
                houseSpins,
                nonce,
                finalReelHash,
                finalSeedHash,
                userHashes,
                initialDeposit,
                betSize,
                nonFounder,
                constants.privateKeys.nonFounder
            )
            let encryptedSpin = AES.encrypt(
                JSON.stringify(spin),
                channelAesKey
            ).toString()

            // Initialize a new DB channel with the house
            dbChannel = handler.getNewDbChannel(
                channelId,
                slotsChannelManager.address,
                initialDeposit,
                initialHouseSeed,
                finalUserHash,
                finalReelHash,
                finalSeedHash,
                nonFounder
            )

            // Process spin as the house
            await handler.processSpin(
                channelId,
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
            )
            nonce++
        } catch (e) {
            // Valid result
            console.log('Thrown', e.message)
            validated = false
        }

        assert.equal(validated, true, 'Spin should be valid')

        // Second spin
        validated = true

        try {
            for (let i = 0; i < 20; i++) {
                // Max number of lines
                let betSize = utils.getRandomBetSize()
                console.log(
                    'Random bet size',
                    new BigNumber(betSize)
                        .dividedBy(utils.getEthInWei())
                        .toString()
                )

                // User spin
                let spin = await handler.getSpin(
                    houseSpins,
                    nonce,
                    finalReelHash,
                    finalSeedHash,
                    userHashes,
                    initialDeposit,
                    betSize,
                    nonFounder,
                    constants.privateKeys.nonFounder
                )
                let encryptedSpin = AES.encrypt(
                    JSON.stringify(spin),
                    channelAesKey
                ).toString()

                // Process spin as the house
                await handler.processSpin(
                    channelId,
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
                )
                nonce++
            }
        } catch (e) {
            // Valid result
            console.log('Thrown', e.message)
            validated = false
        }

        assert.equal(validated, true, 'Spins should be valid')
    })

    it('disallows non participants from finalizing a channel', async () => {
        // Max number of lines
        let betSize = '5000000000000000000'

        // User spin
        let userSpin = await handler.getSpin(
            houseSpins,
            nonce,
            finalReelHash,
            finalSeedHash,
            userHashes,
            initialDeposit,
            betSize,
            nonParticipant,
            constants.privateKeys.nonParticipant,
            true
        )

        let lastHouseSpin = houseSpins[houseSpins.length - 1]

        console.log(userSpin.sign, lastHouseSpin.sign)

        userSpin = handler.getSpinParts(userSpin)
        let houseSpin = handler.getSpinParts(lastHouseSpin)

        await utils.assertFail(
            slotsChannelFinalizer.finalize(
                channelId,
                userSpin.parts,
                houseSpin.parts,
                userSpin.r,
                userSpin.s,
                houseSpin.r,
                houseSpin.s,
                {
                    from: nonParticipant,
                    gas: 6700000
                }
            )
        )
    })

    it('disallows participants from finalizing a channel with invalid data', async () => {
        // Max number of lines
        let betSize = '5000000000000000000'

        // User spin
        let userSpin = await handler.getSpin(
            houseSpins,
            nonce,
            finalReelHash,
            finalSeedHash,
            userHashes,
            initialDeposit,
            betSize,
            nonFounder,
            constants.privateKeys.nonFounder,
            true
        )

        // Update userSpin to use invalid data
        userSpin.reelHash = 'a'
        let lastHouseSpin = houseSpins[houseSpins.length - 1]

        console.log(userSpin.sign, lastHouseSpin.sign)

        userSpin = handler.getSpinParts(userSpin)
        let houseSpin = handler.getSpinParts(lastHouseSpin)

        await utils.assertFail(
            slotsChannelFinalizer.finalize(
                channelId,
                userSpin.parts,
                houseSpin.parts,
                userSpin.r,
                userSpin.s,
                houseSpin.r,
                houseSpin.s,
                {
                    from: nonFounder,
                    gas: 6700000
                }
            )
        )
    })

    it('disallows participants from claiming a channel before it closes', async () => {
        await utils.assertFail(
            slotsChannelManager.claim(channelId, {
                from: nonFounder
            })
        )
    })

    it('allows participants to finalize a channel with valid data', async () => {
        // Max number of lines
        let betSize = '5000000000000000000'

        // User spin
        let userSpin = await handler.getSpin(
            houseSpins,
            nonce,
            finalReelHash,
            finalSeedHash,
            userHashes,
            initialDeposit,
            betSize,
            nonFounder,
            constants.privateKeys.nonFounder,
            true
        )

        let lastHouseSpin = houseSpins[houseSpins.length - 1]

        console.log(userSpin.sign, lastHouseSpin.sign)

        userSpin = handler.getSpinParts(userSpin)
        let houseSpin = handler.getSpinParts(lastHouseSpin)

        await slotsChannelFinalizer.finalize(
            channelId,
            userSpin.parts,
            houseSpin.parts,
            userSpin.r,
            userSpin.s,
            houseSpin.r,
            houseSpin.s,
            {
                from: nonFounder,
                gas: 6700000
            }
        )

        let channelInfo = await slotsChannelManager.getChannelInfo(channelId)
        let finalized = channelInfo[3]

        assert.equal(finalized, true, 'Channel was not finalized')
    })

    it('disallows non participants from claiming a channel after it closes', async () => {
        // Channel end time is 24 hours. Forward the time to 24 hours after a channel has been finalized
        const oneDay = 24 * 60 * 60
        await timeTravel(oneDay)
        await utils.assertFail(
            slotsChannelManager.claim(channelId, {
                from: nonParticipant
            })
        )
    })

    it('allows user to claim a channel after it closes', async () => {
        let userChannelBalance = await slotsChannelManager.channelBalanceOf(
            channelId,
            false
        )

        let houseChannelBalance = await slotsChannelManager.channelBalanceOf(
            channelId,
            true
        )

        let currentSession = await slotsChannelManager.currentSession()
        currentSession = currentSession.toNumber()

        let userBalancePreClaim = await slotsChannelManager.balanceOf(
            nonFounder,
            currentSession
        )

        let houseBalancePreClaim = await slotsChannelManager.balanceOf(
            slotsChannelManager.address,
            currentSession
        )

        console.log(
            'User channel balance',
            userChannelBalance.toFixed(),
            '\nUser balance pre-claim',
            userBalancePreClaim.toFixed()
        )

        console.log(
            'House channel balance',
            houseChannelBalance.toFixed(),
            '\nHouse balance pre-claim',
            houseBalancePreClaim.toFixed()
        )

        await slotsChannelManager.claim(channelId, {
            from: nonFounder
        })

        let userBalancePostClaim = await slotsChannelManager.balanceOf(
            nonFounder,
            currentSession
        )

        console.log('User balance post claim', userBalancePostClaim.toFixed())

        assert.equal(
            userBalancePostClaim.toFixed(),
            userBalancePreClaim.add(userChannelBalance).toFixed(),
            'Invalid user balance post claim'
        )

        userChannelBalance = await slotsChannelManager.channelBalanceOf(
            channelId,
            false
        )
        userChannelBalance = userChannelBalance.toNumber()

        assert.equal(
            userChannelBalance,
            0,
            'Invalid user channel balance post claim'
        )

        let houseBalancePostClaim = await slotsChannelManager.balanceOf(
            slotsChannelManager.address,
            currentSession
        )

        console.log('House balance post claim', houseBalancePostClaim.toFixed())

        assert.equal(
            houseBalancePostClaim.toFixed(),
            houseBalancePreClaim.toFixed(),
            'Invalid house balance post claim'
        )
    })

    it('allows house to claim a channel after it closes', async () => {
        let userChannelBalance = await slotsChannelManager.channelBalanceOf(
            channelId,
            false
        )

        let houseChannelBalance = await slotsChannelManager.channelBalanceOf(
            channelId,
            true
        )

        let currentSession = await slotsChannelManager.currentSession()
        currentSession = currentSession.toNumber()

        let userBalancePreClaim = await slotsChannelManager.balanceOf(
            nonFounder,
            currentSession
        )

        let houseBalancePreClaim = await slotsChannelManager.balanceOf(
            slotsChannelManager.address,
            currentSession
        )

        console.log(
            'User channel balance',
            userChannelBalance.toFixed(),
            '\nUser balance pre-claim',
            userBalancePreClaim.toFixed()
        )

        console.log(
            'House channel balance',
            houseChannelBalance.toFixed(),
            '\nHouse balance pre-claim',
            houseBalancePreClaim.toFixed()
        )

        await slotsChannelManager.claim(channelId, {
            from: founder
        })

        let userBalancePostClaim = await slotsChannelManager.balanceOf(
            nonFounder,
            currentSession
        )

        console.log('User balance post claim', userBalancePostClaim.toFixed())

        assert.equal(
            userBalancePostClaim.toFixed(),
            userBalancePreClaim.toFixed(),
            'Invalid user balance '
        )

        userChannelBalance = await slotsChannelManager.channelBalanceOf(
            channelId,
            false
        )
        userChannelBalance = userChannelBalance.toNumber()

        assert.equal(userChannelBalance, 0, 'Invalid user channel balance')

        let houseBalancePostClaim = await slotsChannelManager.balanceOf(
            slotsChannelManager.address,
            currentSession
        )

        console.log('House balance post claim', houseBalancePostClaim.toFixed())

        assert.equal(
            houseBalancePostClaim.toFixed(),
            houseBalancePreClaim.add(houseChannelBalance).toFixed(),
            'Invalid house balance post claim'
        )

        houseChannelBalance = await slotsChannelManager.channelBalanceOf(
            channelId,
            true
        )
        houseChannelBalance = houseChannelBalance.toNumber()

        assert.equal(
            houseChannelBalance,
            0,
            'Invalid user channel balance post claim'
        )
    })

    it('allows players to finalize channel with a 0 nonce', async () => {
        clearChannelState()

        // Create a channel
        let initialDeposit = '500000000000000000000'

        let receipt = await slotsChannelManager.createChannel(initialDeposit, {
            from: nonFounder
        })

        channelId = receipt.logs[0].args.id

        // Deposit to channel
        let depositParams = await handler.getChannelDepositParams(
            channelId,
            constants.privateKeys.nonFounder
        )

        channelAesKey = depositParams.channelAesKey
        initialUserNumber = depositParams.initialUserNumber
        userHashes = depositParams.userHashes
        finalUserHash = depositParams.finalUserHash

        console.log('Channel deposit params', initialUserNumber, finalUserHash)
        await slotsChannelManager.depositChannel(
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

        // Activate channel
        try {
            initialHouseSeed = await handler.getAesKey(
                finalUserHash,
                constants.privateKeys.house
            )
            reelsAndHashes = handler.generateReelsAndHashes(
                initialHouseSeed,
                channelId
            )

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

            let isAuthorized = await houseAuthorizedController.authorized(
                founder
            )
            console.log('Activate channel - isAuthorized', isAuthorized)

            await slotsChannelManager.activateChannel(
                channelId,
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

        // Finalize channel
        // Max number of lines
        let betSize = '5000000000000000000'

        // User spin
        let userSpin = await handler.getSpin(
            houseSpins,
            nonce,
            finalReelHash,
            finalSeedHash,
            userHashes,
            initialDeposit,
            betSize,
            nonFounder,
            constants.privateKeys.nonFounder,
            true
        )

        userSpin = handler.getSpinParts(userSpin)

        const emptyBytes32 =
            '0x0000000000000000000000000000000000000000000000000000000000000000'

        await slotsChannelFinalizer.finalize(
            channelId,
            userSpin.parts,
            '',
            userSpin.r,
            userSpin.s,
            emptyBytes32,
            emptyBytes32,
            {
                from: nonFounder,
                gas: 6700000
            }
        )

        channelInfo = await slotsChannelManager.getChannelInfo(channelId)
        let finalized = channelInfo[3]

        console.log('Finalized', channelId, finalized)

        assert.equal(finalized, true, 'Channel was not finalized')
    })

    it('Returns correct line reward multipliers', async () => {
        const symbolA = 1
        const symbolB = 2
        const symbolC = 3
        const symbolD = 4
        const symbolE = 5
        const symbolF = 6
        const symbolG = 7

        let paytable = {}
        paytable[symbolA] = 10
        paytable[symbolB] = 20
        paytable[symbolC] = 40
        paytable[symbolD] = 50
        paytable[symbolE] = 75
        paytable[symbolF] = 150
        paytable[symbolG] = 300

        let reel

        for (let i = symbolA; i <= symbolG; i++) {
            for (let j = 1; j <= 5; j++) {
                reel = Array(5)
                    .fill(0)
                    .fill(i, 0, j)
                    .fill(0, j, 5)

                let expectedRewardMultiplier =
                    j >= 3 ? paytable[i] * (j - 2) : 0

                let rewardMultiplier = await slotsHelper.getLineRewardMultiplier(
                    reel
                )
                rewardMultiplier = rewardMultiplier.toNumber()

                assert.equal(
                    expectedRewardMultiplier,
                    rewardMultiplier,
                    'Incorrect expected reward multiplier'
                )
            }
        }
    })
})
