let MultiSigWallet = artifacts.require('MultiSigWallet')
let DecentBetToken = artifacts.require('TestDecentBetToken')
let House = artifacts.require('House')
let HouseAuthorizedController = artifacts.require('HouseAuthorizedController')
let HouseFundsController = artifacts.require('HouseFundsController')
let HouseLotteryController = artifacts.require('HouseLotteryController')
let HouseSessionsController = artifacts.require('HouseSessionsController')
let KycManager = artifacts.require('KycManager')
let BettingProvider = artifacts.require('BettingProvider')
let BettingProviderHelper = artifacts.require('BettingProviderHelper')
let SportsOracle = artifacts.require('SportsOracle')
let SlotsChannelManager = artifacts.require('SlotsChannelManager')
let SlotsChannelFinalizer = artifacts.require('SlotsChannelFinalizer')

module.exports = {
    MultiSigWallet,
    DecentBetToken,
    House,
    HouseAuthorizedController,
    HouseFundsController,
    HouseLotteryController,
    HouseSessionsController,
    KycManager,
    BettingProvider,
    BettingProviderHelper,
    SportsOracle,
    SlotsChannelManager,
    SlotsChannelFinalizer
}
