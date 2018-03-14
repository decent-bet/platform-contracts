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

let slotsChannelManager
let bettingProvider
let sportsOracle

let founder
let nonFounder
let nonParticipant

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

contract('SlotsChannelManager', accounts => {
    it('initializes house contract', async () => {
        founder = accounts[0]
        nonFounder = accounts[1]
        nonInvestor = accounts[2]

        wallet = await contracts.MultiSigWallet.deployed()
        token = await contracts.DecentBetToken.deployed()
        house = await contracts.House.deployed()
        bettingProvider = await contracts.BettingProvider.deployed()
        sportsOracle = await contracts.SportsOracle.deployed()
        slotsChannelManager = await contracts.SlotsChannelManager.deployed()

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
        let depositParams = await handler.getChannelDepositParams(
            channelId,
            constants.privateKeys.nonFounder
        )

        channelAesKey = depositParams.channelAesKey
        initialUserNumber = depositParams.initialUserNumber
        userHashes = depositParams.userHashes
        finalUserHash = depositParams.finalUserHash

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
            console.log('Validate w/ invalid prop', prop)
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
                console.log('Thrown', e.message)
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
            let betSize = '5000000000000000000'

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
            // Max number of lines
            let betSize = '5000000000000000000'

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

            console.log('Spin', spin)

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
    })

    it('disallows non participants from finalizing a channel', async () => {})

    it('disallows participants from finalizing a channel with invalid data', async () => {})

    it('disallows participants from claiming a channel before it closes', async () => {})

    it('allows participants to close a channel with valid data', async () => {})

    it('allows participants to claim a channel after it closes', async () => {})
})
