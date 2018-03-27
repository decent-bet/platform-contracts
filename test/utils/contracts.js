let MultiSigWallet = artifacts.require('MultiSigWallet')
let DecentBetToken = artifacts.require('TestDecentBetToken')
let House = artifacts.require('House')
let HouseLottery = artifacts.require('HouseLottery')
let BettingProvider = artifacts.require('BettingProvider')
let SportsOracle = artifacts.require('SportsOracle')
let SlotsChannelManager = artifacts.require('SlotsChannelManager')
let SlotsChannelFinalizer = artifacts.require('SlotsChannelFinalizer')

module.exports = {
    MultiSigWallet,
    DecentBetToken,
    House,
    HouseLottery,
    BettingProvider,
    SportsOracle,
    SlotsChannelManager,
    SlotsChannelFinalizer
}
