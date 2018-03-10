let utils = require('./utils/utils.js')

let MultiSigWallet = artifacts.require('MultiSigWallet')
let DecentBetToken = artifacts.require('TestDecentBetToken')
let House = artifacts.require('House')
let HouseLottery = artifacts.require('HouseLottery')
let BettingProvider = artifacts.require('BettingProvider')
let BettingProviderHelper = artifacts.require('BettingProviderHelper')
let IndependentSlotsChannelManager = artifacts.require('IndependentSlotsChannelManager')

let wallet
let token
let house

let independentSlotsChannelManager

let founder
let nonFounder

contract('IndependentSlotsChannelManager', accounts => {
    it('initializes independent slots channel manager contract', async () => {
        founder = accounts[0]
        nonFounder = accounts[1]
oyed()
        wallet = await MultiSigWallet.deployed()
        token = await DecentBetToken.deployed()
        house = await House.deployed()
        independentSlotsChannelManager = await SlotsChannelManager.deployed()

        let _founder = await house.founder()
        assert.equal(founder, _founder, 'Invalid founder')

        let houseToken = await house.decentBetToken()

        console.log(token.address, houseToken)
        assert.equal(
            token.address,
            houseToken,
            'Invalid token address in house'
        )
    })
})