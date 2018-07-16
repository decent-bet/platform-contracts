const BigNumber = require('bignumber.js')

const utils = require('./utils/utils')
const contracts = require('./utils/contracts')

let wallet
let token
let house
let houseAuthorizedController
let houseFundsController
let houseSessionsController
let houseLotteryController
let bettingProviderHelper

let slotsChannelManager
let bettingProvider
let newBettingProvider

let founder
let nonFounder
let nonInvestor
let nonKycVerified

let isMockTime
let gasUsage = {}

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

const execAndLogGasUsed = async (name, fn) => {
    let tx = await fn()
    gasUsage[name] = tx.receipt.gasUsed
}

contract('House', accounts => {
    it('initializes house contract', async () => {
        founder = accounts[0]
        nonFounder = accounts[1]
        nonInvestor = accounts[2]
        nonKycVerified = accounts[9]

        wallet = await contracts.MultiSigWallet.deployed()
        token = await contracts.DecentBetToken.deployed()
        house = await contracts.House.deployed()
        houseAuthorizedController = await contracts.HouseAuthorizedController.deployed()
        houseFundsController = await contracts.HouseFundsController.deployed()
        houseSessionsController = await contracts.HouseSessionsController.deployed()

        isMockTime = await house.isMock()

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
                houseAuthorizedController.addToAuthorizedAddresses(nonFounder, {
                    from: nonFounder
                })
            )
        })

        it('allows founder to add authorized addresses', async () => {
            await houseAuthorizedController.addToAuthorizedAddresses(
                nonFounder,
                {
                    from: founder
                }
            )
            let authorized = await houseAuthorizedController.authorized.call(
                nonFounder
            )
            assert.equal(
                authorized,
                true,
                'Founder could not add authorized address'
            )
        })

        it('disallows non-founders from setting lottery contract address', async () => {
            houseLotteryController = await contracts.HouseLotteryController.deployed()
            await utils.assertFail(
                house.setHouseLotteryControllerAddress(
                    houseLotteryController.address,
                    { from: nonFounder }
                )
            )
        })

        it('sets lottery contract address as a founder', async () => {
            console.log('House lottery', houseLotteryController.address)
            await house.setHouseLotteryControllerAddress(
                houseLotteryController.address,
                { from: founder }
            )
            let lotteryAddress = await house.houseLotteryController()
            assert.equal(
                houseLotteryController.address,
                lotteryAddress,
                'Founder could not set lottery contract address'
            )
        })

        it('disallows non-founders from removing authorized addresses', async () => {
            await utils.assertFail(
                houseAuthorizedController.removeFromAuthorizedAddresses(
                    nonFounder,
                    { from: nonFounder }
                )
            )
        })

        it('allows founder to remove authorized addresses', async () => {
            await houseAuthorizedController.removeFromAuthorizedAddresses(
                nonFounder,
                { from: founder }
            )
            let authorized = await houseAuthorizedController.authorized.call(
                nonFounder
            )
            assert.equal(
                authorized,
                false,
                'Founder could not remove authorized address'
            )
        })

        it('disallows non-founders from adding house offerings', async () => {
            bettingProviderHelper = await contracts.BettingProviderHelper.deployed()
            let newOffering = await contracts.BettingProvider.new(
                token.address,
                house.address,
                houseAuthorizedController.address,
                bettingProviderHelper.address
            )
            await utils.assertFail(
                houseSessionsController.addHouseOffering(newOffering.address, {
                    from: nonFounder
                })
            )
        })

        it('disallows founders from adding non house offerings as house offerings', async () => {
            let nonOffering = nonFounder
            await utils.assertFail(
                houseSessionsController.addHouseOffering(nonOffering, {
                    from: founder
                })
            )
        })

        it('allows founders to add house offerings', async () => {
            newBettingProvider = await contracts.BettingProvider.new(
                token.address,
                house.address,
                houseAuthorizedController.address,
                bettingProviderHelper.address
            )

            await execAndLogGasUsed('Add house offering', async () => {
                return houseSessionsController.addHouseOffering(
                    newBettingProvider.address,
                    {
                        from: founder
                    }
                )
            })

            let exists = await houseSessionsController.doesOfferingExist(
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

        it('disallows users from purchasing house credits if they try to purchase under 1 DBET', async () => {
            const creditsToPurchase = '100000000000000000' // 0.1 DBETs
            await token.faucet({ from: nonFounder })
            await token.approve(house.address, creditsToPurchase, {
                from: nonFounder
            })
            await utils.assertFail(
                house.purchaseCredits(creditsToPurchase, { from: nonFounder })
            )
        })

        it('disallows users from purchasing house credits if they are not KYC verified', async () => {
            const creditsToPurchase = '1000000000000000000000'
            await token.faucet({ from: nonKycVerified })
            await token.approve(house.address, creditsToPurchase, {
                from: nonKycVerified
            })
            await utils.assertFail(
                house.purchaseCredits(creditsToPurchase, {
                    from: nonKycVerified
                })
            )
        })

        it('allows users to purchase house credits if they have a DBET balance', async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()
            let nextSession = currentSession + 1
            const lotteryTicketsDividor = new BigNumber(1000)
                .times(utils.getEthInWei())
                .toFixed()
            const creditsToPurchase = lotteryTicketsDividor
            let totalPurchasedCredits = new BigNumber(0)

            for (let i = 0; i < 6; i++) {
                await token.approve(house.address, creditsToPurchase, {
                    from: nonFounder
                })
                await house.purchaseCredits(creditsToPurchase, {
                    from: nonFounder
                })
                totalPurchasedCredits = totalPurchasedCredits.plus(
                    creditsToPurchase
                )

                let lotteryTickets = await houseLotteryController.getUserTicketCount(
                    nextSession,
                    nonFounder
                )
                lotteryTickets = lotteryTickets.toFixed()

                // Maximum of 5 lottery tickets
                let expectedLotteryTickets =
                    i === 5
                        ? 5
                        : totalPurchasedCredits
                              .dividedBy(creditsToPurchase)
                              .toFixed()
                assert.equal(
                    lotteryTickets,
                    expectedLotteryTickets,
                    'Invalid lottery tickets for nonFounder: ' +
                        lotteryTickets +
                        ', ' +
                        totalPurchasedCredits.toFixed()
                )

                let userCredits = await houseFundsController.getUserCreditsForSession(
                    nextSession,
                    nonFounder
                )
                let sessionCredits = userCredits[0].toFixed()
                let expectedSessionCredits = totalPurchasedCredits.toFixed()
                assert.equal(
                    sessionCredits,
                    expectedSessionCredits,
                    'Invalid house credits for no'
                )
            }

            for (let i = 3; i < accounts.length - 1; i++) {
                let user = accounts[i]
                await token.faucet({ from: user })
                let tokenBalance = await token.balanceOf(user)
                const creditsToPurchase = utils.getRandomCreditsToPurchase()
                console.log(
                    'Token balance',
                    user,
                    utils.convertWeiToEth(tokenBalance),
                    ', credits to purchase',
                    utils.convertWeiToEth(creditsToPurchase)
                )
                let totalPurchasedCredits = new BigNumber(0)

                await token.approve(house.address, creditsToPurchase, {
                    from: user
                })
                await execAndLogGasUsed('Purchase credits', async () => {
                    return house.purchaseCredits(creditsToPurchase, {
                        from: user
                    })
                })

                totalPurchasedCredits = totalPurchasedCredits.plus(
                    creditsToPurchase
                )

                let lotteryTickets = await houseLotteryController.getUserTicketCount(
                    nextSession,
                    user
                )
                lotteryTickets = lotteryTickets.toFixed()

                // Maximum of 5 lottery tickets
                let expectedLotteryTickets = totalPurchasedCredits
                    .dividedBy(lotteryTicketsDividor)
                    .integerValue(BigNumber.ROUND_DOWN)
                    .toString()

                assert.equal(
                    lotteryTickets,
                    expectedLotteryTickets,
                    'Invalid lottery tickets for user ' +
                        user +
                        ': ' +
                        lotteryTickets +
                        ', ' +
                        expectedLotteryTickets +
                        ', ' +
                        utils.convertWeiToEth(totalPurchasedCredits)
                )

                let userCredits = await houseFundsController.getUserCreditsForSession(
                    nextSession,
                    user
                )
                let sessionCredits = userCredits[0].toFixed()
                let expectedSessionCredits = totalPurchasedCredits.toFixed()
                assert.equal(
                    sessionCredits,
                    expectedSessionCredits,
                    'Invalid house credits for user ' + user
                )
            }
        })

        it("disallows users from liquidating house credits when it isn't a profit distribution period", async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            let userCredits = await houseFundsController.getUserCreditsForSession(
                currentSession,
                founder
            )
            let amount = userCredits[0].toFixed()
            await utils.assertFail(
                house.liquidateCredits(currentSession, amount)
            )
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
            bettingProvider = await contracts.BettingProvider.deployed()
            await utils.assertFail(
                house.withdrawPreviousSessionTokensFromHouseOffering(
                    bettingProvider.address,
                    { from: founder }
                )
            )
        })

        it(
            'disallows authorized addresses from allocating tokens to house offerings ' +
                'before the last week of session zero',
            async () => {
                const percentageAllocation = 40
                await utils.assertFail(
                    house.allocateTokensForHouseOffering(
                        percentageAllocation,
                        bettingProvider.address,
                        { from: founder }
                    )
                )
            }
        )

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

        it('disallows authorized addresses to begin session one before tokens have been deposited to offerings', async () => {
            const oneWeek = 7 * 24 * 60 * 60
            await timeTravel(oneWeek)

            utils.assertFail(house.beginNextSession({ from: founder }))
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
                    { from: founder }
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
            await execAndLogGasUsed(
                'Allocate tokens for offering',
                async () => {
                    return house.allocateTokensForHouseOffering(
                        providerPercentageAllocation,
                        newBettingProvider.address,
                        { from: founder }
                    )
                }
            )

            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()
            let nextSession = currentSession + 1

            let providerTokenAllocation = await houseSessionsController.getOfferingDetails(
                nextSession,
                bettingProvider.address
            )
            let providerAllocation = providerTokenAllocation[0].toNumber()
            assert.equal(
                providerAllocation,
                providerPercentageAllocation,
                'Authorized addresses should be able to allocate tokens for house offerings'
            )

            let newProviderTokenAllocation = await houseSessionsController.getOfferingDetails(
                nextSession,
                newBettingProvider.address
            )
            let newProviderAllocation = newProviderTokenAllocation[0].toNumber()
            assert.equal(
                newProviderAllocation,
                providerPercentageAllocation,
                'Authorized addresses should be able to allocate tokens for house offerings'
            )
        })

        it('disallows authorized addresses from finalizing token allocations before total allocation is equal to 100', async () => {
            await utils.assertFail(
                house.finalizeTokenAllocations({ from: founder })
            )
        })

        it('disallows authorized addresses from depositing allocated tokens before token allocation is finalized', async () => {
            await utils.assertFail(
                house.depositAllocatedTokensToHouseOffering(
                    bettingProvider.address,
                    { from: founder }
                )
            )
        })

        it('disallows unauthorized addresses from finalizing token allocations', async () => {
            await utils.assertFail(
                house.finalizeTokenAllocations({ from: nonFounder })
            )
        })

        it('allows authorized addresses to finalize token allocations', async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()
            let nextSession = currentSession + 1

            const slotsPercentageAllocation = 20
            slotsChannelManager = await contracts.SlotsChannelManager.deployed()
            await house.allocateTokensForHouseOffering(
                slotsPercentageAllocation,
                slotsChannelManager.address,
                { from: founder }
            )

            let slotsTokenAllocation = await houseSessionsController.getOfferingDetails(
                nextSession,
                slotsChannelManager.address
            )
            let slotsProviderAllocation = slotsTokenAllocation[0].toNumber()
            assert.equal(
                slotsPercentageAllocation,
                slotsProviderAllocation,
                'Authorized addresses should be able to allocate tokens for house offerings'
            )

            await house.finalizeTokenAllocations({ from: founder })

            let finalizedTokenAllocation = await houseSessionsController.areSessionTokenAllocationsFinalized(
                nextSession
            )

            assert.equal(
                finalizedTokenAllocation,
                true,
                'Token allocation should be finalized'
            )
        })

        it('disallows unauthorized addresses from depositing allocated tokens to house offerings', async () => {
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
            console.log('House balance', utils.convertWeiToEth(houseBalance))

            await house.depositAllocatedTokensToHouseOffering(
                bettingProvider.address,
                { from: founder }
            )
            await house.depositAllocatedTokensToHouseOffering(
                newBettingProvider.address,
                { from: founder }
            )

            await execAndLogGasUsed(
                'Deposited allocated tokens to offering',
                async () => {
                    return house.depositAllocatedTokensToHouseOffering(
                        slotsChannelManager.address,
                        { from: founder }
                    )
                }
            )

            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()
            let nextSession = currentSession + 1

            let providerTokenAllocation = await houseSessionsController.getOfferingDetails(
                nextSession,
                bettingProvider.address
            )
            let depositedToProvider = providerTokenAllocation[1]
            assert.equal(
                depositedToProvider,
                true,
                'Allocated tokens not deposited to betting provider'
            )

            let newProviderTokenAllocation = await houseSessionsController.getOfferingDetails(
                nextSession,
                newBettingProvider.address
            )
            let depositedToNewProvider = newProviderTokenAllocation[1]
            assert.equal(
                depositedToNewProvider,
                true,
                'Allocated tokens not deposited to new betting provider'
            )

            let slotsTokenAllocation = await houseSessionsController.getOfferingDetails(
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
                utils.convertWeiToEth(providerBalance),
                utils.convertWeiToEth(expectedProviderBalance)
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
                utils.convertWeiToEth(newProviderBalance),
                utils.convertWeiToEth(expectedNewProviderBalance)
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
                utils.convertWeiToEth(slotsBalance),
                utils.convertWeiToEth(expectedSlotsBalance)
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

        it('allows authorized addresses to begin session one after the end of session zero', async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            await execAndLogGasUsed('Begin next session', async () => {
                return house.beginNextSession({ from: founder })
            })

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
        it('disallows users from rolling over credits', async () => {
            const creditsToRollOver = '1000000000000000000000'
            await utils.assertFail(
                house.rollOverCredits(creditsToRollOver, { from: nonFounder })
            )
        })

        it('disallows users from liquidating credits', async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            let userCredits = await houseFundsController.getUserCreditsForSession(
                currentSession,
                nonFounder
            )
            let amount = userCredits[0].toFixed()
            await utils.assertFail(
                house.liquidateCredits(currentSession, amount, {
                    from: nonFounder
                })
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

        it('disallows authorized addresses from beginning next session before end of session', async () => {
            let currentSession = await house.currentSession()
            let sessionTimes = await houseSessionsController.getSessionTimes(
                currentSession
            )
            let startTime = sessionTimes[0].toFixed()
            let endTime = sessionTimes[1].toFixed()

            let houseTime = await house.getTime()

            console.log(
                currentSession.toFixed(),
                startTime,
                endTime,
                houseTime.toFixed()
            )

            await utils.assertFail(house.beginNextSession({ from: founder }))
        })

        it('disallows non-authorized addresses from calling houseDeposit in offerings', async () => {
            await token.faucet({from: nonFounder})

            let tokenBalance = await token.balanceOf(nonFounder)
            tokenBalance = tokenBalance.toFixed()

            await token.approve(slotsChannelManager.address, tokenBalance)
            let currentSession = await slotsChannelManager.currentSession()
            currentSession = currentSession.toNumber()

            await utils.assertFail(slotsChannelManager.houseDeposit(currentSession, tokenBalance))
        })

        it('allows authorized addresses to call houseDeposit in offerings mid-session', async () => {
            await token.faucet()

            let tokenBalance = await token.balanceOf(founder)
            tokenBalance = tokenBalance.toFixed()

            await token.approve(slotsChannelManager.address, tokenBalance)
            let currentSession = await slotsChannelManager.currentSession()
            currentSession = currentSession.toNumber()

            let slotsSessionBalancePreDeposit = await slotsChannelManager.balanceOf(
                slotsChannelManager.address,
                currentSession
            )

            await slotsChannelManager.houseDeposit(tokenBalance, currentSession)

            let slotsSessionBalancePostDeposit = await slotsChannelManager.balanceOf(
                slotsChannelManager.address,
                currentSession
            )

            assert.equal(
                slotsSessionBalancePreDeposit.add(tokenBalance).toFixed(),
                slotsSessionBalancePostDeposit.toFixed(),
                'Slots balances are not adding up after house deposit mid-session'
            )

            // Re-load faucet
            await token.faucet()
        })

        it('allows users to purchase credits for the next session during credit buying periods', async () => {
            let oneWeek = 24 * 60 * 60 * 7
            await timeTravel(oneWeek * 11)

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
            console.log(
                'userCredits',
                nextSession,
                utils.convertWeiToEth(sessionCredits)
            )
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
            console.log(
                'userCredits',
                currentSession + 1,
                utils.convertWeiToEth(sessionCredits)
            )
            let houseBalance = await token.balanceOf(house.address)
            houseBalance = houseBalance.toFixed(0)
            console.log('House balance', utils.convertWeiToEth(houseBalance))
            assert.equal(
                creditsToRollOver,
                rolledOverCredits,
                'Invalid rolled over credits for user'
            )
        })

        it(
            'disallows authorized addresses from allocating tokens for house offerings during ' +
                'last week of session before being added to the next session',
            async () => {
                const oneWeek = 7 * 24 * 60 * 60
                await timeTravel(oneWeek)

                let providerPercentageAllocation = 25
                await utils.assertFail(
                    house.allocateTokensForHouseOffering(
                        providerPercentageAllocation,
                        bettingProvider.address,
                        { from: founder }
                    )
                )
            }
        )

        it('allows founders to add offerings to next session', async () => {
            await houseSessionsController.addOfferingToNextSession(
                bettingProvider.address
            )
            await houseSessionsController.addOfferingToNextSession(
                newBettingProvider.address
            )
            await houseSessionsController.addOfferingToNextSession(
                slotsChannelManager.address
            )

            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            let nextSession = currentSession + 1

            let providerOffering = await houseSessionsController.getSessionOffering(
                nextSession,
                0
            )
            let newProviderOffering = await houseSessionsController.getSessionOffering(
                nextSession,
                1
            )
            let slotsChannelManagerOffering = await houseSessionsController.getSessionOffering(
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

        it('allows founders to remove offerings', async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            let nextSession = currentSession + 1

            await houseSessionsController.removeOfferingFromNextSession(
                newBettingProvider.address
            )
            let newProviderOffering = await houseSessionsController.getSessionOffering(
                nextSession,
                1
            )

            const emptyAddress = '0x0000000000000000000000000000000000000000'

            assert.equal(
                newProviderOffering,
                emptyAddress,
                'Invalid new provider address'
            )
        })

        it(
            'allows authorized addresses to allocate tokens for house offerings ' +
                'during last week of session',
            async () => {
                const providerPercentageAllocation = 50
                await house.allocateTokensForHouseOffering(
                    providerPercentageAllocation,
                    bettingProvider.address,
                    { from: founder }
                )

                const slotsPercentageAllocation = 50
                slotsChannelManager = await contracts.SlotsChannelManager.deployed()
                await house.allocateTokensForHouseOffering(
                    slotsPercentageAllocation,
                    slotsChannelManager.address,
                    { from: founder }
                )

                let currentSession = await house.currentSession()
                currentSession = currentSession.toNumber()
                let nextSession = currentSession + 1

                let providerTokenAllocation = await houseSessionsController.getOfferingDetails(
                    nextSession,
                    bettingProvider.address
                )
                let providerAllocation = providerTokenAllocation[0].toNumber()
                assert.equal(
                    providerAllocation,
                    providerPercentageAllocation,
                    'Authorized addresses should be able to allocate tokens for house offerings'
                )

                let slotsTokenAllocation = await houseSessionsController.getOfferingDetails(
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
            'allows authorized addresses to finalize allocated tokens after tokens are allocated during ' +
                'last week of session',
            async () => {
                await house.finalizeTokenAllocations({ from: founder })

                let currentSession = await house.currentSession()
                currentSession = currentSession.toNumber()

                let nextSession = currentSession + 1

                let finalizedTokenAllocation = await houseSessionsController.areSessionTokenAllocationsFinalized(
                    nextSession
                )
                console.log(
                    'finalizedTokenAllocation',
                    finalizedTokenAllocation,
                    nextSession
                )

                assert.equal(
                    finalizedTokenAllocation,
                    true,
                    'Token allocation should be finalized'
                )
            }
        )

        it(
            'allows authorized addresses to deposit allocated tokens for house offerings ' +
                'during last week for session',
            async () => {
                let houseBalance = await token.balanceOf(house.address)
                let initialHouseBalance = houseBalance

                houseBalance = houseBalance.toFixed(0)
                console.log(
                    'House balance before depositing to offerings',
                    utils.convertWeiToEth(houseBalance)
                )

                let currentSession = await house.currentSession()
                currentSession = currentSession.toNumber()
                let nextSession = currentSession + 1

                let providerTokenAllocation = await houseSessionsController.getOfferingDetails(
                    nextSession,
                    bettingProvider.address
                )
                let providerAllocation = providerTokenAllocation[0].toNumber()

                let slotsTokenAllocation = await houseSessionsController.getOfferingDetails(
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

                providerTokenAllocation = await houseSessionsController.getOfferingDetails(
                    nextSession,
                    bettingProvider.address
                )
                let depositedToProvider = providerTokenAllocation[1]
                assert.equal(
                    depositedToProvider,
                    true,
                    'Tokens not deposited to betting provider'
                )

                slotsTokenAllocation = await houseSessionsController.getOfferingDetails(
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

        it('disallows unauthorized addresses from adding profits from unregistered house offerings', async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            let amount = '10000000000000000000000' // 10k DBETs

            await token.approve(house.address, amount)

            await utils.assertFail(
                house.addToSessionProfitsFromUnregisteredHouseOffering(
                    '0x0',
                    currentSession,
                    amount,
                    { from: nonFounder }
                )
            )
        })

        it('allows authorized addresses to add profits from unregistered house offerings', async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            let amount = '10000000000000000000000' // 10k DBETs

            await token.approve(house.address, amount)

            let houseFundsPreAddProfit = await houseFundsController.houseFunds(
                currentSession
            )
            let houseProfitPreAddProfit = houseFundsPreAddProfit[6]

            await house.addToSessionProfitsFromUnregisteredHouseOffering(
                '0x0',
                currentSession,
                amount
            )

            let houseFundsPostAddProfit = await houseFundsController.houseFunds(
                currentSession
            )
            let houseProfitPostAddProfit = houseFundsPostAddProfit[6]

            assert.equal(
                houseProfitPreAddProfit.plus(amount).toFixed(),
                houseProfitPostAddProfit.toFixed(),
                'Invalid profit in houseFunds after adding unregistered offering profits'
            )
        })

        it('allows authorized addresses to begin session two', async () => {
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
        it(
            'disallows authorized addresses from withdrawing previous session tokens from house offerings ' +
                'before withdrawal time',
            async () => {
                await utils.assertFail(
                    house.withdrawPreviousSessionTokensFromHouseOffering(
                        bettingProvider.address,
                        { from: founder }
                    )
                )
            }
        )

        it('disallows non-authorized addresses from withdrawing previous session tokens from house offerings', async () => {
            let oneDay = 24 * 60 * 60
            await timeTravel(oneDay * 2)

            await utils.assertFail(
                house.withdrawPreviousSessionTokensFromHouseOffering(
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
                utils.convertWeiToEth(providerBalance),
                utils.convertWeiToEth(newProviderBalance),
                utils.convertWeiToEth(slotsChannelManagerBalance),
                utils.convertWeiToEth(initialHouseBalance)
            )

            // Betting provider
            await house.withdrawPreviousSessionTokensFromHouseOffering(
                bettingProvider.address,
                { from: founder }
            )

            let houseBalance = await token.balanceOf(house.address)
            houseBalance = houseBalance.toFixed()
            let expectedHouseBalance = initialHouseBalance
                .plus(providerBalance)
                .toFixed()

            console.log(
                'Provider withdraw',
                utils.convertWeiToEth(houseBalance),
                utils.convertWeiToEth(expectedHouseBalance)
            )

            assert.equal(
                houseBalance,
                expectedHouseBalance,
                'Invalid house balance after withdrawing from betting provider'
            )

            // New betting provider
            await house.withdrawPreviousSessionTokensFromHouseOffering(
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
                utils.convertWeiToEth(houseBalance),
                utils.convertWeiToEth(expectedHouseBalance)
            )
            assert.equal(
                houseBalance,
                expectedHouseBalance,
                'Invalid house balance after withdrawing from new betting provider'
            )

            // Slots channel manager
            await house.withdrawPreviousSessionTokensFromHouseOffering(
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

            console.log(
                'Slots withdraw',
                utils.convertWeiToEth(houseBalance),
                utils.convertWeiToEth(expectedHouseBalance)
            )
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

                let userCredits = await houseFundsController.getUserCreditsForSession(
                    previousSession,
                    nonFounder
                )
                let amount = userCredits[0].toFixed()

                await utils.assertFail(
                    house.liquidateCredits(previousSession, amount, {
                        from: nonFounder
                    })
                )
            }
        )

        it(
            'disallows users without credits in session one from liquidating credits ' +
                'during profit distribution period',
            async () => {
                let oneDay = 24 * 60 * 60
                await timeTravel(oneDay * 2)

                let currentSession = await house.currentSession()
                currentSession = currentSession.toNumber()
                let previousSession = currentSession - 1

                let userCredits = await houseFundsController.getUserCreditsForSession(
                    previousSession,
                    nonInvestor
                )
                let amount = userCredits[0].toFixed()
                await utils.assertFail(
                    house.liquidateCredits(previousSession, amount, {
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

            let payoutPerCredit = await houseFundsController.getPayoutPerCredit(
                previousSession
            )
            console.log(
                'Payout per credit',
                utils.convertWeiToEth(payoutPerCredit)
            )

            let houseTokenBalance = await token.balanceOf(house.address)
            console.log(
                'House token balance',
                utils.convertWeiToEth(houseTokenBalance)
            )

            let userTokenBalance = await token.balanceOf(nonFounder)
            console.log(
                'User token balance',
                utils.convertWeiToEth(userTokenBalance)
            )

            console.log(
                'Prev session credits',
                utils.convertWeiToEth(prevSessionCredits)
            )

            await house.liquidateCredits(previousSession, prevSessionCredits, {
                from: nonFounder
            })

            houseTokenBalance = await token.balanceOf(house.address)
            console.log(
                'House token balance',
                utils.convertWeiToEth(houseTokenBalance)
            )

            let userTokenBalancePreLiquidation = userTokenBalance
            userTokenBalance = await token.balanceOf(nonFounder)
            console.log(
                'User token balance',
                utils.convertWeiToEth(userTokenBalance)
            )

            userCreditsForPrevSession = await houseFundsController.getUserCreditsForSession(
                previousSession,
                nonFounder
            )
            let liquidatedCredits = userCreditsForPrevSession[1].toFixed()

            console.log(
                'Liquidated credits',
                userTokenBalance.toFixed(),
                userTokenBalancePreLiquidation.toFixed(),
                prevSessionCredits,
                new BigNumber(utils.convertWeiToEth(payoutPerCredit))
                    .times(prevSessionCredits)
                    .toFixed(),
                userTokenBalancePreLiquidation
                    .plus(
                        new BigNumber(utils.convertWeiToEth(payoutPerCredit))
                            .times(prevSessionCredits)
                            .toFixed()
                    )
                    .toFixed()
            )

            assert.equal(
                userTokenBalance.toFixed(),
                userTokenBalancePreLiquidation
                    .plus(
                        new BigNumber(
                            utils.convertWeiToEth(payoutPerCredit)
                        ).times(prevSessionCredits)
                    )
                    .toFixed(),
                'Invalid balances after liquidating credits'
            )

            assert.equal(
                prevSessionCredits,
                liquidatedCredits,
                'Invalid amount of credits liquidated'
            )

            // TODO: Check for profit vs expected profit after all liquidations
            for (let i = 3; i < accounts.length - 1; i++) {
                let user = accounts[i]
                let userCreditsForPrevSession = await houseFundsController.getUserCreditsForSession(
                    previousSession,
                    user
                )
                let prevSessionCredits = userCreditsForPrevSession[0].toFixed()

                let payoutPerCredit = await houseFundsController.getPayoutPerCredit(
                    previousSession
                )
                console.log(
                    'Payout per credit',
                    utils.convertWeiToEth(payoutPerCredit)
                )

                let houseTokenBalance = await token.balanceOf(house.address)
                console.log(
                    'House token balance',
                    utils.convertWeiToEth(houseTokenBalance)
                )

                let userTokenBalance = await token.balanceOf(user)
                console.log(
                    'User token balance',
                    user,
                    utils.convertWeiToEth(userTokenBalance)
                )

                console.log(
                    'Prev session credits',
                    utils.convertWeiToEth(prevSessionCredits)
                )

                await house.liquidateCredits(
                    previousSession,
                    prevSessionCredits,
                    { from: user }
                )

                houseTokenBalance = await token.balanceOf(house.address)
                console.log(
                    'House token balance',
                    utils.convertWeiToEth(houseTokenBalance)
                )

                userTokenBalancePreLiquidation = userTokenBalance
                userTokenBalance = await token.balanceOf(user)
                console.log(
                    'User token balance',
                    user,
                    utils.convertWeiToEth(userTokenBalance)
                )

                userCreditsForPrevSession = await houseFundsController.getUserCreditsForSession(
                    previousSession,
                    user
                )
                let liquidatedCredits = userCreditsForPrevSession[1].toFixed()

                assert.equal(
                    userTokenBalance.toFixed(),
                    userTokenBalancePreLiquidation
                        .plus(
                            new BigNumber(
                                utils.convertWeiToEth(payoutPerCredit)
                            ).times(prevSessionCredits)
                        )
                        .toFixed(),
                    'Invalid balances after liquidating credits for user: ' +
                        user
                )

                assert.equal(
                    prevSessionCredits,
                    liquidatedCredits,
                    'Invalid amount of credits liquidated for user: ' + user
                )
            }
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

            let payoutPerCredit = await houseFundsController.getPayoutPerCredit(
                previousSession
            )
            let rolledOverFromPrev = userCreditsForPrevSession[2]
            let amountInCurrBeforeClaimingRollOver =
                userCreditsForCurrentSession[0]

            await execAndLogGasUsed('Claim rolled over credits', async () => {
                return house.claimRolledOverCredits({ from: nonFounder })
            })

            userCreditsForCurrentSession = await houseFundsController.getUserCreditsForSession(
                currentSession,
                nonFounder
            )

            let claimedFromPrev = userCreditsForCurrentSession[3]
            let amountInCurrAfterClaimingRollOver =
                userCreditsForCurrentSession[0]

            assert.equal(
                rolledOverFromPrev
                    .times(payoutPerCredit)
                    .dividedBy(ethInWei)
                    .toFixed(),
                claimedFromPrev.toFixed(),
                'Rolled over and claimed are not equal'
            )
            assert.equal(
                amountInCurrAfterClaimingRollOver.toFixed(),
                amountInCurrBeforeClaimingRollOver
                    .plus(
                        rolledOverFromPrev
                            .times(payoutPerCredit)
                            .dividedBy(ethInWei)
                    )
                    .toFixed(),
                'Amount before and after claiming rolled over credits do not match based on payout per credit ' +
                    'for previous session'
            )
        })

        it('disallows non-authorized addresses from picking lottery winners', async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            let previousSession = currentSession - 1

            await utils.assertFail(
                house.pickLotteryWinner(previousSession, { from: nonFounder })
            )
        })

        it('allows authorized addresses to pick lottery winners', async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            let previousSession = currentSession - 1
            console.log('Picking lottery winner for session', previousSession)

            let receipt = await house.pickLotteryWinner(previousSession, {
                from: founder,
                value: '100000000000000000' // 0.1 ETH
            })

            let loggedEvent = receipt.logs[0].event
            assert.equal(
                loggedEvent,
                'LogPickLotteryWinner',
                'Lottery winner not picked'
            )
        })

        it('disallows non-winners from withdrawing lottery winnings', async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            let previousSession = currentSession - 1

            let waitForLogWinnerEvent = async () => {
                return new Promise((resolve, reject) => {
                    let logWinnerEvent = houseLotteryController.LogWinner({
                        fromBlock: 0,
                        toBlock: 'latest'
                    })

                    logWinnerEvent.watch((err, result) => {
                        err ? reject(err) : resolve(result)
                    })
                })
            }

            try {
                let logWinnerEvent = await waitForLogWinnerEvent()
                console.log('LogWinner event:', logWinnerEvent)
                Object.keys(logWinnerEvent.args).map(key => {
                    let val = logWinnerEvent.args[key]
                    console.log(
                        key,
                        typeof val === 'object' ? val.toFixed() : val
                    )
                })

                for (let i = 0; i < 6; i++) {
                    let ticketOwner = await houseLotteryController.lotteryTicketHolders(
                        previousSession,
                        i
                    )
                    console.log('Lottery user ticket', i, ticketOwner)
                }

                await utils.assertFail(
                    house.claimLotteryWinnings(previousSession, {
                        from: nonInvestor
                    })
                )
            } catch (e) {
                // In case promise gets rejected
                assert.fail(0, 1, e.message)
            }
        })

        it('allows winner to withdraw lottery winnings', async () => {
            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            let previousSession = currentSession - 1

            let winner = await houseLotteryController.getLotteryWinner(
                previousSession
            )

            let winnerTokenBalancePreClaim = await token.balanceOf(winner)
            let houseTokenBalancePreClaim = await token.balanceOf(house.address)

            console.log('Lottery winner', winner)

            await execAndLogGasUsed('Claim lottery winnings', async () => {
                return house.claimLotteryWinnings(previousSession, {
                    from: winner
                })
            })

            let winnerTokenBalancePostClaim = await token.balanceOf(winner)
            let houseTokenBalancePostClaim = await token.balanceOf(
                house.address
            )

            let lotteryStats = await houseLotteryController.lotteries(
                previousSession
            )
            let payout = lotteryStats[2]

            assert.equal(
                houseTokenBalancePostClaim.toFixed(),
                new BigNumber(houseTokenBalancePreClaim)
                    .minus(payout)
                    .toFixed(),
                'Invalid house token balance post claim after lottery payout'
            )

            assert.equal(
                winnerTokenBalancePostClaim.toFixed(),
                new BigNumber(winnerTokenBalancePreClaim)
                    .plus(payout)
                    .toFixed(),
                'Invalid winner token balance post claim after lottery payout'
            )
        })

        it('disallows non-founders from emergency pausing house', async () => {
            await utils.assertFail(house.emergencyPause({ from: nonFounder }))
        })

        it('allows founder to emergency pause house', async () => {
            await house.emergencyPause()
            let emergencyPaused = await house.emergencyPaused()
            assert.equal(
                emergencyPaused,
                true,
                'House has not been emergency paused'
            )
        })

        it('disallows non-founders from withdrawing current session tokens from house offerings', async () => {
            await utils.assertFail(
                house.emergencyWithdrawCurrentSessionTokensFromHouseOffering(
                    slotsChannelManager.address,
                    { from: nonFounder }
                )
            )
        })

        it('allows founders to withdraw current session tokens from house offerings', async () => {
            let slotsTokenBalance = await token.balanceOf(
                slotsChannelManager.address
            )
            let houseTokenBalancePreWithdraw = await token.balanceOf(
                house.address
            )

            await execAndLogGasUsed(
                'Emergency withdraw current session tokens from offering',
                async () => {
                    return house.emergencyWithdrawCurrentSessionTokensFromHouseOffering(
                        slotsChannelManager.address
                    )
                }
            )

            let houseTokenBalancePostWithdraw = await token.balanceOf(
                house.address
            )
            assert.equal(
                houseTokenBalancePreWithdraw.plus(slotsTokenBalance).toFixed(),
                houseTokenBalancePostWithdraw.toFixed(),
                'House token balances pre/post withdraw do not match'
            )
        })

        it('disallows users from calling emergency withdraw without enabling emergency withdrawals', async () => {
            await utils.assertFail(
                house.emergencyWithdraw({ from: nonFounder })
            )
        })

        it('disallows non-founders from enabling emergency withdrawals', async () => {
            await utils.assertFail(
                house.enableEmergencyWithdrawals({ from: nonFounder })
            )
        })

        it('allows founders to enable emergency withdrawals', async () => {
            await house.enableEmergencyWithdrawals()

            let emergencyWithdrawalsEnabled = await house.emergencyWithdrawalsEnabled()
            assert.equal(
                emergencyWithdrawalsEnabled,
                true,
                'Emergency withdrawals were not enabled'
            )
        })

        it('allows users to withdraw when emergency withdrawals are enabled', async () => {
            const ethInWei = '1000000000000000000'

            let currentSession = await house.currentSession()
            currentSession = currentSession.toNumber()

            let userCreditsStatsPreWithdraw = await houseFundsController.getUserCreditsForSession(
                currentSession,
                nonFounder
            )
            let userCreditsPreWithdraw = userCreditsStatsPreWithdraw[0]
            let userTokenBalancePreWithdraw = await token.balanceOf(nonFounder)

            let payoutPerCredit = await houseFundsController.getPayoutPerCredit(
                currentSession
            )
            payoutPerCredit = payoutPerCredit.dividedBy(ethInWei)
            let payout = payoutPerCredit.times(userCreditsPreWithdraw)

            await execAndLogGasUsed('Emergency withdraw', async () => {
                return house.emergencyWithdraw({ from: nonFounder })
            })

            let userCreditsStatsPostWithdraw = await houseFundsController.getUserCreditsForSession(
                currentSession,
                nonFounder
            )
            let userCreditsPostWithdraw = userCreditsStatsPostWithdraw[0]
            let userTokenBalancePostWithdraw = await token.balanceOf(nonFounder)

            assert.equal(
                userCreditsPostWithdraw.toFixed(),
                0,
                'User credits are not 0 after emergency withdraw'
            )
            assert.equal(
                userTokenBalancePreWithdraw.plus(payout).toFixed(),
                userTokenBalancePostWithdraw.toFixed(),
                'User token balance does not account for payout after emergency withdraw'
            )

            console.log('Gas usage', gasUsage)
        })
    })
})
