const handler = require('./handler')
const constants = require('./constants')
const BigNumber = require('bignumber.js')

let reel
let totalCost = 0

const NUMBER_OF_TURNS = 1000000

const ETHER = new BigNumber(10).exponentiatedBy(18)

const randomReel = () => {
    const _reel = []
    while(_reel.length < constants.NUMBER_OF_REELS)
        _reel.push(Math.floor(Math.random() * 20))
    return _reel
}

const calcAveragePayout = (multiplier) => {
    let wins = 0
    let totalPayout = 0
    const BET_SIZE = ETHER.times(multiplier)
    for(let i = 0; i < NUMBER_OF_TURNS; i++) {
        reel = randomReel()
        console.log('Reel', reel, multiplier, i)
        let payout = handler.calculateReelPayout(reel, BET_SIZE)
        totalPayout += payout
        if(payout > 0)
            wins++
    }

    totalCost += multiplier * NUMBER_OF_TURNS

    return {
        totalPayout,
        winPercent: wins/NUMBER_OF_TURNS * 100,
        averagePayout: (totalPayout/(NUMBER_OF_TURNS * multiplier))
    }
}

let payouts = {}
let totalPayout = 0
let totalAveragePayout = 0
let totalAverageWinPercent = 0

for(let i = 1; i <= constants.NUMBER_OF_LINES; i++) {
    payouts[i] = calcAveragePayout(i)
    totalPayout += payouts[i].totalPayout
    totalAverageWinPercent += payouts[i].winPercent
    totalAveragePayout += payouts[i].averagePayout
}

console.log('Payouts', payouts)
console.log('Total payout', totalPayout)
console.log('Profit %', (totalCost - totalPayout)/totalCost * 100)
console.log('Average win %', totalAverageWinPercent/constants.NUMBER_OF_LINES)
console.log('Average payout', totalAveragePayout/constants.NUMBER_OF_LINES)
