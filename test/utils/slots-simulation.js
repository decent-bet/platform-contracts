const handler = require('./handler')
const constants = require('./constants')
const BigNumber = require('bignumber.js')

let reel
let totalPayout = 0

const NUMBER_OF_TURNS = 1000000

const BET_SIZE = new BigNumber(10).exponentiatedBy(18)

const randomReel = () => {
    const _reel = []
    while(_reel.length < 5)
        _reel.push(Math.floor(Math.random() * 20))
    return _reel
}

const calcAveragePayout = () => {
    for(let i = 0; i < NUMBER_OF_TURNS; i++) {
        reel = randomReel()
        console.log('Reel', reel)
        totalPayout += handler.calculateReelPayout(reel, BET_SIZE)
    }

    console.log('Total payout', totalPayout)
    console.log('Average payout', totalPayout/NUMBER_OF_TURNS)
}

const getReelName = (index) => {
    return 'Reel ' + (index + 1)
}

const countReelSymbolFrequency = () => {
    let frequency = {}
    for(let i = 1; i <= 7; i++) {
        let symbolFrequency = {}
        for(let j = 0; j < constants.reels.length; j++) {
            symbolFrequency[getReelName(j)] = 0
            constants.reels[j].map((symbol) => {
                if(symbol === i)
                    symbolFrequency[getReelName(j)] += 1
            })
        }
        frequency[i] = symbolFrequency
    }
    console.log('Frequency', frequency)
}

calcAveragePayout()
