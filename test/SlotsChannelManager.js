const BigNumber = require('bignumber.js')

let utils = require("./utils/utils.js")

let MultiSigWallet = artifacts.require("MultiSigWallet")
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
let houseLottery
let bettingProviderHelper

let slotsChannelManager
let bettingProvider
let newBettingProvider
let sportsOracle

let founder
let nonFounder
let nonInvestor

contract('SlotsChannelManager', (accounts) => {

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

        let _founder = await house.founder()
        assert.equal(founder, _founder, 'Invalid founder')

        let houseToken = await house.decentBetToken()
        assert.equal(token.address, houseToken, 'Invalid token address in house')

        console.log('Begin next session..')
        await house.beginNextSession()

        await house.allocateTokensForHouseOffering(50, bettingProvider.address)
        await house.allocateTokensForHouseOffering(50, slotsChannelManager.address)

        await token.ownerFaucet()
        const houseCreditsAmount = '50000000000000000000000000'
        await token.approve(house.address, houseCreditsAmount, {from: founder})

        await house.purchaseCredits(houseCreditsAmount, {from: founder})

        const nextWeek = (new Date().getTime() / 1000) + (7 * 24 * 60 * 60) + 1
        await house.setTime(nextWeek, {from: founder})

        await house.depositAllocatedTokensToHouseOffering(bettingProvider.address, {from: founder})
        await house.depositAllocatedTokensToHouseOffering(slotsChannelManager.address, {from: founder})

        const sessionOneTime = (new Date().getTime() / 1000) + (14 * 24 * 60 * 60) + 1
        await house.setTime(sessionOneTime, {from: founder})

        await house.beginNextSession()
        await bettingProvider.setSportsOracle(sportsOracle.address)
        await sportsOracle.acceptProvider(bettingProvider.address)

        let currentSession = await house.currentSession()
        currentSession = currentSession.toNumber()
        assert.equal(currentSession, 1, 'Invalid current session number')

        let firstOffering = await house.offeringAddresses(0)
        assert.equal(bettingProvider.address, firstOffering, 'Invalid betting provider offering address')

        let secondOffering = await house.offeringAddresses(1)
        assert.equal(slotsChannelManager.address, secondOffering, 'Invalid slots channel manager offering address')

        let depositedAmount = new BigNumber(houseCreditsAmount).dividedBy(2).toFixed()

        let slotsDeposit = await slotsChannelManager.balanceOf(slotsChannelManager.address, currentSession)
        let bettingProviderDeposit = await bettingProvider.balanceOf(bettingProvider.address, currentSession)

        assert.equal(slotsDeposit.toFixed(), depositedAmount, 'Invalid slots deposit amount')
        assert.equal(bettingProviderDeposit.toFixed(), depositedAmount, 'Invalid betting provider deposit amount')
    })

})