let contracts = require('./utils/contracts.js')

let wallet
let token
let house
let houseAuthorizedController
let houseFundsController
let houseSessionsController

let founder
let nonFounder
let nonInvestor

contract('House', accounts => {
    console.log('Accounts', accounts)
    it('initializes kyc contract', async () => {
        founder = accounts[0]
        nonFounder = accounts[1]
        nonInvestor = accounts[2]

        wallet = await contracts.MultiSigWallet.deployed()
        token = await contracts.DecentBetToken.deployed()
        house = await contracts.House.deployed()
        houseAuthorizedController = await contracts.HouseAuthorizedController.deployed()
        houseFundsController = await contracts.HouseFundsController.deployed()
        houseSessionsController = await contracts.HouseSessionsController.deployed()

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

    it('disallows non-owners from adding authorized addresses', async () => {})

    it('disallows owners from removing non-authorized addresses', async () => {})

    it('allows owners to add authorized addresses', async () => {})

    it('disallows non-owners from removing authorized addresses', async () => {})

    it('allows owners to remove authorized addresses', async () => {})

    it('disallows unauthorized addresses from adding approved addresses', async () => {})

    it('disallows authorized addresses from removing non-approved addresses', async () => {})

    it('disallows authorized addresses from adding approved addresses without a valid check ID and/or signed message', async () => {})

    it('allows authorized addresses to add approved addresses with a valid check ID and signed message', async () => {})

    it('disallows unauthorized addresses from removing approved addresses', async () => {})

    it('allows authorized addresses to remove approved addresses', async () => {})

})
