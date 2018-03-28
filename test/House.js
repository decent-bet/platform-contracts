const BigNumber = require('bignumber.js')

let utils = require('./utils/utils.js')

let MultiSigWallet = artifacts.require('MultiSigWallet')
let DecentBetToken = artifacts.require('TestDecentBetToken')
let House = artifacts.require('House')
let HouseFundsController = artifacts.require('HouseFundsController')
let HouseLottery = artifacts.require('HouseLottery')
let BettingProvider = artifacts.require('BettingProvider')
let BettingProviderHelper = artifacts.require('BettingProviderHelper')
let SlotsChannelManager = artifacts.require('SlotsChannelManager')

let wallet
let token
let house
let houseFundsController
let houseLottery
let bettingProviderHelper

let slotsChannelManager
let bettingProvider
let newBettingProvider

let founder
let nonFounder
let nonInvestor

contract('House', accounts => {
    it('initializes house contract', async () => {
        founder = accounts[0]
        nonFounder = accounts[1]
        nonInvestor = accounts[2]

        wallet = await MultiSigWallet.deployed()
        token = await DecentBetToken.deployed()
        house = await House.deployed()
        houseFundsController = await HouseFundsController.deployed()

        await token.ownerFaucet()

        let _founder = await house.founder()
        assert.equal(founder, _founder, 'Invalid founder')

        let houseToken = await house.decentBetToken()
        assert.equal(
            token.address,
            houseToken,
            'Invalid token address in house'
        )
    })

    describe('before session zero', () => {
        it('disallows non-founders from adding authorized addresses', async () => {
            await utils.assertFail(
                house.addToAuthorizedAddresses.sendTransaction(nonFounder, {
                    from: nonFounder
                })
            )
        })

        it('allows founder to add authorized addresses', async () => {
            await house.addToAuthorizedAddresses.sendTransaction(nonFounder, {
                from: founder
            })
            let authorized = await house.authorized.call(nonFounder)
            assert.equal(
                authorized,
                true,
                'Founder could not add authorized address'
            )
        })

        it('disallows non-founders from setting lottery contract address', async () => {
            houseLottery = await HouseLottery.deployed()
            await utils.assertFail(
                house.setHouseLotteryAddress.sendTransaction(
                    houseLottery.address,
                    { from: nonFounder }
                )
            )
        })

        it('sets lottery contract address as a founder', async () => {
            await house.setHouseLotteryAddress.sendTransaction(
                houseLottery.address,
                { from: founder }
            )
            let lotteryAddress = await house.houseLottery()
            assert.equal(
                houseLottery.address,
                lotteryAddress,
                'Founder could not set lottery contract address'
            )
        })

        it('disallows non-founders from removing authorized addresses', async () => {
            await utils.assertFail(
                house.removeFromAuthorizedAddresses.sendTransaction(
                    nonFounder,
                    { from: nonFounder }
                )
            )
        })

        it('allows founder to remove authorized addresses', async () => {
            await house.removeFromAuthorizedAddresses.sendTransaction(
                nonFounder,
                { from: founder }
            )
            let authorized = await house.authorized.call(nonFounder)
            assert.equal(
                authorized,
                false,
                'Founder could not remove authorized address'
            )
        })

        it('disallows non-founders from adding house offerings', async () => {
            bettingProviderHelper = await BettingProviderHelper.deployed()
            let newOffering = await BettingProvider.new(
                token.address,
                house.address,
                bettingProviderHelper.address
            )
            await utils.assertFail(
                house.addHouseOffering(newOffering.address, {
                    from: nonFounder
                })
            )
        })

        it('disallows founders from adding non house offerings as house offerings', async () => {
            let nonOffering = nonFounder
            await utils.assertFail(
                house.addHouseOffering(nonOffering, { from: founder })
            )
        })

        it('allows founders to add house offerings', async () => {
            newBettingProvider = await BettingProvider.new(
                token.address,
                house.address,
                bettingProviderHelper.address
            )
            await house.addHouseOffering(newBettingProvider.address, {
                from: founder
            })
            let exists = await house.doesOfferingExist(
                newBettingProvider.address
            )
            assert.equal(
                exists,
                true,
                'House offering could not be added as a founder'
            )
        })

        it('disallows users from purchasing credits', async () => {
            await utils.assertFail(house.purchaseCredits(1))
        })

        it('disallows non-authorized addresses from beginning session zero', async () => {
            await utils.assertFail(house.beginNextSession({ from: nonFounder }))
        })

        it('allows authorized addresses to begin session zero', async () => {
            await house.beginNextSession({ from: founder })
            let startTime = await house.sessionZeroStartTime()
            assert.notEqual(
                startTime,
                0,
                'Authorized addresses are not able to begin session zero'
            )
        })
    })

    describe('during session zero', () => {
        it('disallows users from purchasing house credits if they do not have a DBET balance', async () => {
            const creditsToPurchase = '1000000000000000000000'
            await utils.assertFail(
                house.purchaseCredits(creditsToPurchase, { from: nonFounder })
            )
        })

        it('disallows users from purchasing house credits if they try to purchase under 1000 DBETs', async () => {
            const creditsToPurchase = '100000000000000000000'
            await token.faucet({ from: nonFounder })
            await token.approve(house.address, creditsToPurchase, {
                from: nonFounder
            })
            await utils.assertFail(
                house.purchaseCredits(creditsToPurchase, { from: nonFounder })
            )
        })

        it('allows users to purchase house credits if they have a DBET balance', async () => {
            const creditsToPurchase = '1000000000000000000000'
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()
            let nextSession = currentSession + 1
            let totalPurchasedCredits = new BigNumber(0)

            for(let i = 0; i < 6; i++) {
                await token.approve(house.address, creditsToPurchase, {
                    from: nonFounder
                })
                await house.purchaseCredits(creditsToPurchase, { from: nonFounder })
                totalPurchasedCredits = totalPurchasedCredits.add(creditsToPurchase)

                let lotteryTickets = await houseLottery.getUserTicketCount(nextSession, nonFounder)
                lotteryTickets = lotteryTickets.toFixed()

                // Maximum of 5 lottery tickets
                let expectedLotteryTickets = i === 5 ? 5 : totalPurchasedCredits.dividedBy(creditsToPurchase).toFixed()
                assert.equal(lotteryTickets, expectedLotteryTickets,
                    'Invalid lottery tickets for user: ' + lotteryTickets + ', ' + totalPurchasedCredits.toFixed())

                let userCredits = await houseFundsController.getUserCreditsForSession(
                    nextSession,
                    nonFounder
                )
                let sessionCredits = userCredits[0].toFixed()
                let expectedSessionCredits = totalPurchasedCredits.toFixed()
                assert.equal(
                    sessionCredits,
                    expectedSessionCredits,
                    'Invalid house credits for user'
                )
            }
        })

        it("disallows users from liquidating house credits when it isn't a profit distribution period", async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()
            await utils.assertFail(house.liquidateCredits(currentSession))
        })

        it("disallows users from rolling over credits when it isn't a profit distribution period", async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()
            let userCredits = await houseFundsController.getUserCreditsForSession(
                currentSession,
                nonFounder
            )
            let sessionCredits = userCredits[0].toFixed()
            await utils.assertFail(house.rollOverCredits(sessionCredits))
        })

        it('disallows founders from withdrawing previous session tokens from house offerings', async () => {
            bettingProvider = await BettingProvider.deployed()
            await utils.assertFail(
                house.withdrawPreviousSessionTokensFromHouseOffering(
                    bettingProvider.address,
                    { from: founder }
                )
            )
        })

        it('disallows unauthorized addresses from allocating tokens for house offerings', async () => {
            const percentageAllocation = 50
            await utils.assertFail(
                house.allocateTokensForHouseOffering(
                    percentageAllocation,
                    bettingProvider.address,
                    { from: nonFounder }
                )
            )
        })

        it('disallows authorized addresses from allocating more than 100% of tokens to house offerings', async () => {
            const percentageAllocation = 101
            await utils.assertFail(
                house.allocateTokensForHouseOffering(
                    percentageAllocation,
                    bettingProvider.address,
                    { from: nonFounder }
                )
            )
        })

        it('allows authorized addresses to allocate tokens for house offerings', async () => {
            const providerPercentageAllocation = 40
            await house.allocateTokensForHouseOffering(
                providerPercentageAllocation,
                bettingProvider.address,
                { from: founder }
            )
            await house.allocateTokensForHouseOffering(
                providerPercentageAllocation,
                newBettingProvider.address,
                { from: founder }
            )

            const slotsPercentageAllocation = 20
            slotsChannelManager = await SlotsChannelManager.deployed()
            await house.allocateTokensForHouseOffering(
                slotsPercentageAllocation,
                slotsChannelManager.address,
                { from: founder }
            )

            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()
            let nextSession = currentSession + 1

            let providerTokenAllocation = await house.getOfferingTokenAllocations(
                nextSession,
                bettingProvider.address
            )
            let providerAllocation = providerTokenAllocation[0].toNumber()
            assert.equal(
                providerAllocation,
                providerPercentageAllocation,
                'Authorized addresses should be able to allocate tokens for house offerings'
            )

            let newProviderTokenAllocation = await house.getOfferingTokenAllocations(
                nextSession,
                newBettingProvider.address
            )
            let newProviderAllocation = newProviderTokenAllocation[0].toNumber()
            assert.equal(
                newProviderAllocation,
                providerPercentageAllocation,
                'Authorized addresses should be able to allocate tokens for house offerings'
            )

            let slotsTokenAllocation = await house.getOfferingTokenAllocations(
                nextSession,
                slotsChannelManager.address
            )
            let slotsProviderAllocation = slotsTokenAllocation[0].toNumber()
            assert.equal(
                slotsPercentageAllocation,
                slotsProviderAllocation,
                'Authorized addresses should be able to allocate tokens for house offerings'
            )
        })

        it(
            'disallows authorized addresses from depositing allocated tokens to house offerings ' +
                'before the last week of session zero',
            async () => {
                await utils.assertFail(
                    house.depositAllocatedTokensToHouseOffering(
                        bettingProvider.address,
                        { from: founder }
                    )
                )
            }
        )

        it('disallows unauthorized addresses from depositing allocated tokens to house offerings', async () => {
            let startTime = await house.sessionZeroStartTime()
            startTime = startTime.toNumber()
            const oneWeek = 7 * 24 * 60 * 60
            let lastWeekTime = startTime + oneWeek

            await house.setTime(lastWeekTime, { from: founder })
            await utils.assertFail(
                house.depositAllocatedTokensToHouseOffering(
                    bettingProvider.address,
                    { from: nonFounder }
                )
            )
        })

        it('allows authorized addresses to deposit allocated tokens to house offerings', async () => {
            let houseBalance = await token.balanceOf(house.address)
            houseBalance = houseBalance.toFixed(0)
            console.log('House balance', houseBalance)

            await house.depositAllocatedTokensToHouseOffering(
                bettingProvider.address,
                { from: founder }
            )
            await house.depositAllocatedTokensToHouseOffering(
                newBettingProvider.address,
                { from: founder }
            )
            await house.depositAllocatedTokensToHouseOffering(
                slotsChannelManager.address,
                { from: founder }
            )

            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()
            let nextSession = currentSession + 1

            let providerTokenAllocation = await house.getOfferingTokenAllocations(
                nextSession,
                bettingProvider.address
            )
            let depositedToProvider = providerTokenAllocation[1]
            assert.equal(
                depositedToProvider,
                true,
                'Allocated tokens not deposited to betting provider'
            )

            let newProviderTokenAllocation = await house.getOfferingTokenAllocations(
                nextSession,
                newBettingProvider.address
            )
            let depositedToNewProvider = newProviderTokenAllocation[1]
            assert.equal(
                depositedToNewProvider,
                true,
                'Allocated tokens not deposited to new betting provider'
            )

            let slotsTokenAllocation = await house.getOfferingTokenAllocations(
                nextSession,
                slotsChannelManager.address
            )
            let depositedToSlots = slotsTokenAllocation[1]
            assert.equal(
                depositedToSlots,
                true,
                'Allocated tokens not deposited to slots channel manager'
            )

            let providerBalance = await bettingProvider.balanceOf(
                bettingProvider.address,
                nextSession
            )
            providerBalance = providerBalance.toFixed()
            let expectedProviderBalance = new BigNumber(houseBalance)
                .times(providerTokenAllocation[0])
                .dividedBy(100)
                .toFixed()

            console.log(
                'Provider balance',
                providerBalance,
                expectedProviderBalance
            )
            assert.equal(
                providerBalance,
                expectedProviderBalance,
                'Invalid provider balance after depositing'
            )

            let newProviderBalance = await newBettingProvider.balanceOf(
                newBettingProvider.address,
                nextSession
            )
            newProviderBalance = newProviderBalance.toFixed()
            let expectedNewProviderBalance = new BigNumber(houseBalance)
                .times(newProviderTokenAllocation[0])
                .dividedBy(100)
                .toFixed()

            console.log(
                'New provider balance',
                newProviderBalance,
                expectedNewProviderBalance
            )
            assert.equal(
                newProviderBalance,
                expectedNewProviderBalance,
                'Invalid new provider balance after depositing'
            )

            let slotsBalance = await slotsChannelManager.balanceOf(
                slotsChannelManager.address,
                nextSession
            )
            slotsBalance = slotsBalance.toFixed()
            let expectedSlotsBalance = new BigNumber(houseBalance)
                .times(slotsTokenAllocation[0])
                .dividedBy(100)
                .toFixed()

            console.log(
                'Slots channel manager balance',
                slotsBalance,
                expectedSlotsBalance
            )
            assert.equal(
                slotsBalance,
                expectedSlotsBalance,
                'Invalid slots balance after depositing'
            )
        })

        it('disallows unauthorized addresses from beginning session one', () => {
            utils.assertFail(house.beginNextSession({ from: nonFounder }))
        })

        it('disallows authorized addresses to begin session one', () => {
            utils.assertFail(house.beginNextSession({ from: founder }))
        })

        it('allows authorized addresses to begin session one after the end of session zero', async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            let startTime = await house.sessionZeroStartTime()
            startTime = startTime.toNumber()
            const oneWeek = 7 * 24 * 60 * 60
            let endOfSessionTime = startTime + oneWeek * 2

            await house.setTime(endOfSessionTime, { from: founder })
            await house.beginNextSession({ from: founder })
            let nextSession = await house.currentSession()

            assert.equal(
                currentSession + 1,
                nextSession,
                'Authorized addresses should be able to begin session one at the end of session zero'
            )

            let providerSession = await bettingProvider.currentSession()
            assert.equal(
                currentSession + 1,
                providerSession,
                'Betting provider session number is not equal to house session number'
            )

            let newProviderSession = await newBettingProvider.currentSession()
            assert.equal(
                currentSession + 1,
                newProviderSession,
                'New betting provider session number is not equal to house session number'
            )

            let slotsChannelManagerSession = await slotsChannelManager.currentSession()
            assert.equal(
                currentSession + 1,
                slotsChannelManagerSession,
                'Slots Channel Manager session number is not equal to house session number'
            )
        })
    })

    describe('during session one', () => {
        it('disallowing users from rolling over credits', async () => {
            const creditsToRollOver = '1000000000000000000000'
            await utils.assertFail(
                house.rollOverCredits(creditsToRollOver, { from: nonFounder })
            )
        })

        it('disallows users from liquidating credits', async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()
            await utils.assertFail(
                house.liquidateCredits(currentSession, { from: nonFounder })
            )
        })

        it('disallows users from purchasing credits', async () => {
            const creditsToPurchase = '1000000000000000000000'
            await utils.assertFail(
                house.purchaseCredits(creditsToPurchase, { from: nonFounder })
            )
        })

        it('disallows authorized addresses from withdrawing previous session tokens', async () => {
            await utils.assertFail(
                house.withdrawPreviousSessionTokensFromHouseOffering(
                    bettingProvider.address,
                    { from: founder }
                )
            )
        })

        it('disallows authorized addresses from allocating tokens for house offerings', async () => {
            let providerPercentageAllocation = 25
            await utils.assertFail(
                house.allocateTokensForHouseOffering(
                    providerPercentageAllocation,
                    bettingProvider.address,
                    { from: founder }
                )
            )
        })

        it('disallows authorized addresses from depositing tokens for house offerings', async () => {
            await utils.assertFail(
                house.depositAllocatedTokensToHouseOffering(
                    bettingProvider.address,
                    { from: founder }
                )
            )
        })

        it('disallows authorized addresses from beginning next session', async () => {
            await utils.assertFail(house.beginNextSession({ from: founder }))
        })

        it('allows users to purchase credits for the next session during credit buying periods', async () => {
            let houseTime = await house.getTime()
            houseTime = houseTime.toNumber()

            let oneWeek = 24 * 60 * 60 * 7
            let creditBuyingPeriodTime = houseTime + oneWeek * 10
            await house.setTime(creditBuyingPeriodTime)

            const creditsToPurchase = '1000000000000000000000'
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()
            let nextSession = currentSession + 1
            await token.faucet({ from: nonFounder })
            await token.approve(house.address, creditsToPurchase, {
                from: nonFounder
            })
            await house.purchaseCredits(creditsToPurchase, { from: nonFounder })
            let userCredits = await houseFundsController.getUserCreditsForSession(
                nextSession,
                nonFounder
            )
            let sessionCredits = userCredits[0].toFixed()
            console.log('userCredits', nextSession, sessionCredits)
            assert.equal(
                sessionCredits,
                creditsToPurchase,
                'Invalid house credits for user'
            )
        })

        it('allows users to roll over credits for the next session during credit buying periods', async () => {
            const creditsToRollOver = '500000000000000000000'
            await house.rollOverCredits(creditsToRollOver, { from: nonFounder })

            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()
            let userCredits = await houseFundsController.getUserCreditsForSession(
                currentSession,
                nonFounder
            )
            let rolledOverCredits = userCredits[2].toFixed()

            let nextSession = currentSession + 1
            userCredits = await houseFundsController.getUserCreditsForSession(
                nextSession,
                nonFounder
            )
            let sessionCredits = userCredits[0].toFixed()
            console.log('userCredits', currentSession + 1, sessionCredits)
            let houseBalance = await token.balanceOf(house.address)
            houseBalance = houseBalance.toFixed(0)
            console.log('House balance', houseBalance)
            assert.equal(
                creditsToRollOver,
                rolledOverCredits,
                'Invalid rolled over credits for user'
            )
        })

        it(
            'allows authorized addresses to allocate tokens for house offerings ' +
                'during credit buying period',
            async () => {
                const providerPercentageAllocation = 40
                await house.allocateTokensForHouseOffering(
                    providerPercentageAllocation,
                    bettingProvider.address,
                    { from: founder }
                )
                await house.allocateTokensForHouseOffering(
                    providerPercentageAllocation,
                    newBettingProvider.address,
                    { from: founder }
                )

                const slotsPercentageAllocation = 20
                slotsChannelManager = await SlotsChannelManager.deployed()
                await house.allocateTokensForHouseOffering(
                    slotsPercentageAllocation,
                    slotsChannelManager.address,
                    { from: founder }
                )

                let currentSession = await house.currentSession()
                currentSession = currentSession.toNumber()
                let nextSession = currentSession + 1

                let providerTokenAllocation = await house.getOfferingTokenAllocations(
                    nextSession,
                    bettingProvider.address
                )
                let providerAllocation = providerTokenAllocation[0].toNumber()
                assert.equal(
                    providerAllocation,
                    providerPercentageAllocation,
                    'Authorized addresses should be able to allocate tokens for house offerings'
                )

                let newProviderTokenAllocation = await house.getOfferingTokenAllocations(
                    nextSession,
                    newBettingProvider.address
                )
                let newProviderAllocation = newProviderTokenAllocation[0].toNumber()
                assert.equal(
                    newProviderAllocation,
                    providerPercentageAllocation,
                    'Authorized addresses should be able to allocate tokens for house offerings'
                )

                let slotsTokenAllocation = await house.getOfferingTokenAllocations(
                    nextSession,
                    slotsChannelManager.address
                )
                let slotsProviderAllocation = slotsTokenAllocation[0].toNumber()
                assert.equal(
                    slotsPercentageAllocation,
                    slotsProviderAllocation,
                    'Authorized addresses should be able to allocate tokens for house offerings'
                )
            }
        )

        it(
            'allows authorized addresses to deposit allocated tokens for house offerings ' +
                'during last week for session',
            async () => {
                let houseTime = await house.getTime()
                houseTime = houseTime.toNumber()
                const oneWeek = 7 * 24 * 60 * 60
                let lastWeekTime = houseTime + oneWeek

                await house.setTime(lastWeekTime, { from: founder })

                let houseBalance = await token.balanceOf(house.address)
                let initialHouseBalance = houseBalance

                houseBalance = houseBalance.toFixed(0)
                console.log(
                    'House balance before depositing to offerings',
                    houseBalance
                )

                let currentSession = await house.currentSession()
                currentSession = currentSession.toNumber()
                let nextSession = currentSession + 1

                let providerTokenAllocation = await house.getOfferingTokenAllocations(
                    nextSession,
                    bettingProvider.address
                )
                let providerAllocation = providerTokenAllocation[0].toNumber()

                let newProviderTokenAllocation = await house.getOfferingTokenAllocations(
                    nextSession,
                    newBettingProvider.address
                )
                let newProviderAllocation = newProviderTokenAllocation[0].toNumber()

                let slotsTokenAllocation = await house.getOfferingTokenAllocations(
                    nextSession,
                    slotsChannelManager.address
                )
                let slotsAllocation = slotsTokenAllocation[0].toNumber()

                // Betting provider
                let expectedProviderDeposit = initialHouseBalance
                    .times(providerAllocation)
                    .dividedBy(100)
                let expectedHouseBalance = initialHouseBalance.minus(
                    expectedProviderDeposit
                )

                await house.depositAllocatedTokensToHouseOffering(
                    newBettingProvider.address,
                    { from: founder }
                )
                houseBalance = await token.balanceOf(house.address)
                houseBalance = houseBalance.toFixed(0)

                assert.equal(
                    expectedHouseBalance.toFixed(),
                    houseBalance,
                    'Invalid amount deposited to new betting provider'
                )

                // Slots channel manager
                let expectedSlotsDeposit = initialHouseBalance
                    .times(slotsAllocation)
                    .dividedBy(100)
                expectedHouseBalance = new BigNumber(houseBalance).minus(
                    expectedSlotsDeposit
                )

                await house.depositAllocatedTokensToHouseOffering(
                    slotsChannelManager.address,
                    { from: founder }
                )
                houseBalance = await token.balanceOf(house.address)
                houseBalance = houseBalance.toFixed(0)

                assert.equal(
                    expectedHouseBalance.toFixed(),
                    houseBalance,
                    'Invalid amount deposited to slots channel manager'
                )

                // New betting provider
                let expectedNewProviderDeposit = initialHouseBalance
                    .times(newProviderAllocation)
                    .dividedBy(100)
                expectedHouseBalance = new BigNumber(houseBalance).minus(
                    expectedNewProviderDeposit
                )

                await house.depositAllocatedTokensToHouseOffering(
                    bettingProvider.address,
                    { from: founder }
                )
                houseBalance = await token.balanceOf(house.address)
                houseBalance = houseBalance.toFixed(0)

                assert.equal(
                    expectedHouseBalance.toFixed(),
                    houseBalance,
                    'Invalid amount deposited to betting provider'
                )

                providerTokenAllocation = await house.getOfferingTokenAllocations(
                    nextSession,
                    bettingProvider.address
                )
                let depositedToProvider = providerTokenAllocation[1]
                assert.equal(
                    depositedToProvider,
                    true,
                    'Tokens not deposited to betting provider'
                )

                newProviderTokenAllocation = await house.getOfferingTokenAllocations(
                    nextSession,
                    newBettingProvider.address
                )
                let depositedToNewProvider = newProviderTokenAllocation[1]
                assert.equal(
                    depositedToNewProvider,
                    true,
                    'Tokens not deposited to betting new betting provider'
                )

                slotsTokenAllocation = await house.getOfferingTokenAllocations(
                    nextSession,
                    slotsChannelManager.address
                )
                let depositedToSlots = slotsTokenAllocation[1]
                assert.equal(
                    depositedToSlots,
                    true,
                    'Tokens not deposited to slots channel manager'
                )
            }
        )

        it('allows founders to add offerings to next session', async () => {
            await house.addHouseOffering(bettingProvider.address)
            await house.addHouseOffering(newBettingProvider.address)
            await house.addHouseOffering(slotsChannelManager.address)

            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            let nextSession = currentSession + 1

            let providerOffering = await house.getSessionOffering(
                nextSession,
                0
            )
            let newProviderOffering = await house.getSessionOffering(
                nextSession,
                1
            )
            let slotsChannelManagerOffering = await house.getSessionOffering(
                nextSession,
                2
            )

            assert.equal(
                providerOffering,
                bettingProvider.address,
                'Invalid provider address'
            )
            assert.equal(
                newProviderOffering,
                newBettingProvider.address,
                'Invalid new provider address'
            )
            assert.equal(
                slotsChannelManagerOffering,
                slotsChannelManager.address,
                'Invalid slots channel manager address'
            )
        })

        it('disallows unauthorized addresses from adding profits from unregistered house offerings', async () => {

        })

        it('allows authorized addresses to add profits from unregistered house offerings', async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            let amount = '10000000000000000000000' // 10k DBETs

            await token.approve(house.address, amount)

            let houseFundsPreAddProfit = await houseFundsController.houseFunds(currentSession)
            let houseProfitPreAddProfit = houseFundsPreAddProfit[6]

            let tokenBalance = await token.balanceOf(founder)
            console.log('Token balance', tokenBalance)

            await house.addToSessionProfitsFromUnregisteredHouseOffering('0x0', currentSession, amount)

            let houseFundsPostAddProfit = await houseFundsController.houseFunds(currentSession)
            let houseProfitPostAddProfit = houseFundsPostAddProfit[6]

            assert.equal(houseProfitPreAddProfit.add(amount).toFixed(), houseProfitPostAddProfit.toFixed(),
                'Invalid profit in houseFunds after adding unregistered offering profits')
        })

        it('allows authorized addresses to begin session two', async () => {
            let houseTime = await house.getTime()
            houseTime = houseTime.toNumber()
            const oneWeek = 7 * 24 * 60 * 60
            let endOfSessionTime = houseTime + oneWeek

            await house.setTime(endOfSessionTime, { from: founder })
            await house.beginNextSession({ from: founder })
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            let nextSession = currentSession + 1

            assert.equal(
                currentSession,
                nextSession - 1,
                'Authorized addresses should be able to begin session one at the end of session zero'
            )
        })
    })

    describe('after session one', () => {
        it('disallows authorized addresses from withdrawing previous session tokens from house offerings before withdrawal time', async () => {
            await utils.assertFail(
                house.withdrawPreviousSessionTokensFromHouseOffering.sendTransaction(
                    bettingProvider.address,
                    { from: founder }
                )
            )
        })

        it('disallows non-authorized addresses from withdrawing previous session tokens from house offerings', async () => {
            let time = await house.getTime()
            time = time.toNumber()

            let oneDay = 24 * 60 * 60

            let withdrawalPeriodTime = time + oneDay * 2
            await house.setTime(withdrawalPeriodTime, { from: founder })

            await utils.assertFail(
                house.withdrawPreviousSessionTokensFromHouseOffering.sendTransaction(
                    bettingProvider.address,
                    { from: nonFounder }
                )
            )
        })

        it('allows authorized addresses to withdraw previous session tokens from house offerings', async () => {
            let currentSession = await house.currentSession()
            let previousSession = currentSession.toNumber() - 1

            let providerBalance = await bettingProvider.balanceOf(
                bettingProvider.address,
                previousSession
            )
            providerBalance = providerBalance.toFixed()

            let newProviderBalance = await newBettingProvider.balanceOf(
                newBettingProvider.address,
                previousSession
            )
            newProviderBalance = newProviderBalance.toFixed()

            let slotsChannelManagerBalance = await slotsChannelManager.balanceOf(
                slotsChannelManager.address,
                previousSession
            )
            slotsChannelManagerBalance = slotsChannelManagerBalance.toFixed()

            let initialHouseBalance = await token.balanceOf(house.address)

            console.log(
                'Balances',
                previousSession,
                providerBalance,
                newProviderBalance,
                slotsChannelManagerBalance,
                initialHouseBalance.toFixed()
            )

            // Betting provider
            await house.withdrawPreviousSessionTokensFromHouseOffering.sendTransaction(
                bettingProvider.address,
                { from: founder }
            )

            let houseBalance = await token.balanceOf(house.address)
            houseBalance = houseBalance.toFixed()
            let expectedHouseBalance = initialHouseBalance
                .plus(providerBalance)
                .toFixed()

            console.log('Provider withdraw', houseBalance, expectedHouseBalance)
            assert.equal(
                houseBalance,
                expectedHouseBalance,
                'Invalid house balance after withdrawing from betting provider'
            )

            // New betting provider
            await house.withdrawPreviousSessionTokensFromHouseOffering.sendTransaction(
                newBettingProvider.address,
                { from: founder }
            )

            houseBalance = await token.balanceOf(house.address)
            houseBalance = houseBalance.toFixed()
            expectedHouseBalance = initialHouseBalance
                .plus(providerBalance)
                .plus(newProviderBalance)
                .toFixed()

            console.log(
                'New provider withdraw',
                houseBalance,
                expectedHouseBalance
            )
            assert.equal(
                houseBalance,
                expectedHouseBalance,
                'Invalid house balance after withdrawing from new betting provider'
            )

            // Slots channel manager
            await house.withdrawPreviousSessionTokensFromHouseOffering.sendTransaction(
                slotsChannelManager.address,
                { from: founder }
            )

            houseBalance = await token.balanceOf(house.address)
            houseBalance = houseBalance.toFixed()
            expectedHouseBalance = initialHouseBalance
                .plus(providerBalance)
                .plus(newProviderBalance)
                .plus(slotsChannelManagerBalance)
                .toFixed()

            console.log('Slots withdraw', houseBalance, expectedHouseBalance)
            assert.equal(
                houseBalance,
                expectedHouseBalance,
                'Invalid house balance after withdrawing from slots channel manager'
            )
        })

        it(
            'disallows users with credits in session one from liquidating credits ' +
                'before profit distribution period',
            async () => {
                let currentSession = await house.currentSession()
                currentSession = currentSession.toNumber()
                let previousSession = currentSession - 1
                await utils.assertFail(
                    house.liquidateCredits.sendTransaction(previousSession, {
                        from: nonFounder
                    })
                )
            }
        )

        it(
            'disallows users without credits in session one from liquidating credits ' +
                'during profit distribution period',
            async () => {
                let time = await house.getTime()
                time = time.toNumber()
                let oneDay = 24 * 60 * 60

                let profitDistributionPeriodTime = time + oneDay * 3

                console.log('House time', time, profitDistributionPeriodTime)
                await house.setTime(profitDistributionPeriodTime, {
                    from: founder
                })

                let currentSession = await house.currentSession()
                currentSession = currentSession.toNumber()
                let previousSession = currentSession - 1
                await utils.assertFail(
                    house.liquidateCredits.sendTransaction(previousSession, {
                        from: nonInvestor
                    })
                )
            }
        )

        it('allows users to liquidate credits during profit distribution period', async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()
            let previousSession = currentSession - 1

            let userCreditsForPrevSession = await houseFundsController.getUserCreditsForSession(
                previousSession,
                nonFounder
            )
            let prevSessionCredits = userCreditsForPrevSession[0].toFixed()

            let payoutPerCredit = await houseFundsController.getPayoutPerCredit(previousSession)
            console.log('Payout per credit', payoutPerCredit.toFixed())

            let houseTokenBalance = await token.balanceOf(house.address)
            console.log('House token balance', houseTokenBalance.toFixed())

            let userTokenBalance = await token.balanceOf(nonFounder)
            console.log('User token balance', userTokenBalance.toFixed())

            console.log('Prev session credits', prevSessionCredits)

            await house.liquidateCredits(previousSession, { from: nonFounder })

            // TODO: Verify balances after liquidation
            houseTokenBalance = await token.balanceOf(house.address)
            console.log('House token balance', houseTokenBalance.toFixed())

            userTokenBalance = await token.balanceOf(nonFounder)
            console.log('User token balance', userTokenBalance.toFixed())

            userCreditsForPrevSession = await houseFundsController.getUserCreditsForSession(
                previousSession,
                nonFounder
            )
            let liquidatedCredits = userCreditsForPrevSession[1].toFixed()

            assert.equal(
                prevSessionCredits,
                liquidatedCredits,
                'Invalid amount of credits liquidated'
            )
        })

        it(
            "disallows users from claiming rolled over credits if they hadn't rolled over " +
                'during session one',
            async () => {
                utils.assertFail(
                    house.claimRolledOverCredits({ from: nonInvestor })
                )
            }
        )

        it('allows users to claim rolled over credits after session one', async () => {
            const ethInWei = '1000000000000000000'
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()
            let previousSession = currentSession - 1

            let userCreditsForCurrentSession = await houseFundsController.getUserCreditsForSession(
                currentSession,
                nonFounder
            )
            let userCreditsForPrevSession = await houseFundsController.getUserCreditsForSession(
                previousSession,
                nonFounder
            )

            let payoutPerCredit = await houseFundsController.getPayoutPerCredit(previousSession)
            let rolledOverFromPrev = userCreditsForPrevSession[2]
            let amountInCurrBeforeClaimingRollOver = userCreditsForCurrentSession[0]

            await house.claimRolledOverCredits({ from: nonFounder })

            userCreditsForCurrentSession = await houseFundsController.getUserCreditsForSession(
                currentSession,
                nonFounder
            )

            let claimedFromPrev = userCreditsForCurrentSession[3]
            let amountInCurrAfterClaimingRollOver = userCreditsForCurrentSession[0]

            assert.equal(
                rolledOverFromPrev.times(payoutPerCredit).dividedBy(ethInWei).toFixed(),
                claimedFromPrev.toFixed(),
                'Rolled over and claimed are not equal'
            )
            assert.equal(
                amountInCurrAfterClaimingRollOver.toFixed(),
                amountInCurrBeforeClaimingRollOver
                    .plus(rolledOverFromPrev.times(payoutPerCredit).dividedBy(ethInWei))
                    .toFixed(),
                'Amount before and after claiming rolled over credits do not match'
            )
        })

        it('disallows non-authorized addresses from picking lottery winners', async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            let previousSession = currentSession - 1

            await utils.assertFail(
                house.pickLotteryWinner(previousSession,
                    { from: nonFounder }
                )
            )
        })

        it('allows authorized addresses to pick lottery winners', async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            let previousSession = currentSession - 1
            console.log('Picking lottery winner for session', previousSession)

            let receipt = await house.pickLotteryWinner(previousSession,
                {
                    from: founder,
                    value: '100000000000000000' // 0.1 ETH
                }
            )

            let loggedEvent = receipt.logs[0].event
            assert.equal(loggedEvent, 'LogPickLotteryWinner', 'Lottery winner not picked')
        })

        it('disallows non-winners from withdrawing lottery winnings', async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            let previousSession = currentSession - 1

            let waitForLogWinnerEvent = async () => {
                return new Promise((resolve, reject) => {
                    let logWinnerEvent = houseLottery.LogWinner({fromBlock: 0, toBlock: 'latest'})

                    logWinnerEvent.watch((err, result) => {
                        err ? reject(err) : resolve(result)
                    })
                })
            }

            try {
                await waitForLogWinnerEvent()
                await utils.assertFail(
                    house.claimLotteryWinnings(previousSession,
                        { from: nonInvestor }
                    )
                )
            } catch (e) {
                // In case promise gets rejected
                asserrt.fail(0, 1, e.message)
            }
        })

        it('allows winners to withdraw lottery winnings', async () => {
            // TODO: Get this case to work correctly
            const ethInWei = '1000000000000000000'
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            let previousSession = currentSession - 1

            let lotteryStats = await houseLottery.lotteries(previousSession)
            let winningTicket = lotteryStats[1].toNumber()

            let winner = await houseLottery.lotteryTicketHolders(previousSession, winningTicket)

            let winnerTokenBalancePreClaim = await token.balanceOf(nonFounder)
            winnerTokenBalancePreClaim = winnerTokenBalancePreClaim.dividedBy(ethInWei).toFixed()

            let houseTokenBalancePreClaim = await token.balanceOf(house.address)
            houseTokenBalancePreClaim = houseTokenBalancePreClaim.dividedBy(ethInWei).toFixed()

            let houseFunds = await houseFundsController.houseFunds(previousSession)
            console.log('House funds', houseFunds[6].toFixed())

            console.log(winnerTokenBalancePreClaim, houseTokenBalancePreClaim, winner, winningTicket)

            let lotteryClaims = await house.claimLotteryWinnings.call(previousSession,
                { from: nonFounder }
            )

            lotteryClaims = lotteryClaims.map((claim) => {
                return claim.dividedBy(ethInWei).toFixed()
            })
            console.log('Claimed winnings', lotteryClaims)

            let winnerTokenBalancePostClaim = await token.balanceOf(nonFounder)
            winnerTokenBalancePostClaim = winnerTokenBalancePostClaim.dividedBy(ethInWei).toFixed()

            let houseTokenBalancePostClaim = await token.balanceOf(house.address)
            houseTokenBalancePostClaim = houseTokenBalancePostClaim.dividedBy(ethInWei).toFixed()

            lotteryStats = await houseLottery.lotteries(previousSession)
            let payout = lotteryStats[2]
            payout = payout.toFixed()

            console.log(winnerTokenBalancePostClaim, houseTokenBalancePostClaim, payout, winner)
        })
    })
})
