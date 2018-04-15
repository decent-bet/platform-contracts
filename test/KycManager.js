let constants = require('./utils/constants.js')
let contracts = require('./utils/contracts.js')
let utils = require('./utils/utils')

let wallet
let token
let house
let houseAuthorizedController
let houseFundsController
let houseSessionsController
let kycManager

let founder
let nonFounder
let nonAuthorized

const SAMPLE_CHECK_ID = '8546921-123123-123123'

contract('KYC Manager', accounts => {
    console.log('Accounts', accounts)
    it('initializes kyc contract', async () => {
        founder = accounts[0]
        nonFounder = accounts[1]
        nonAuthorized = accounts[2]

        wallet = await contracts.MultiSigWallet.deployed()
        token = await contracts.DecentBetToken.deployed()
        house = await contracts.House.deployed()
        houseAuthorizedController = await contracts.HouseAuthorizedController.deployed()
        houseFundsController = await contracts.HouseFundsController.deployed()
        houseSessionsController = await contracts.HouseSessionsController.deployed()
        kycManager = await contracts.KycManager.deployed()

        await token.ownerFaucet()

        let _founder = await kycManager.founder()
        assert.equal(founder, _founder, 'Invalid founder')
    })

    it('disallows non-founders from adding authorized addresses', async () => {
        await utils.assertFail(
            kycManager.addAuthorizedAddress(nonFounder, { from: nonFounder })
        )
    })

    it('disallows founders from removing non-authorized addresses', async () => {
        await utils.assertFail(
            kycManager.removeAuthorizedAddress(nonFounder, 0, { from: founder })
        )
    })

    it('allows founders to add authorized addresses', async () => {
        let authorized = await kycManager.authorized(nonFounder)

        assert.equal(authorized, false, 'Non founder should not be authorized')

        await kycManager.addAuthorizedAddress(nonFounder)

        authorized = await kycManager.authorized(nonFounder)

        assert.equal(
            authorized,
            true,
            'Founder unable to add authorized addresses'
        )
    })

    it('disallows non-founders from removing authorized addresses', async () => {
        await utils.assertFail(
            kycManager.removeAuthorizedAddress(nonFounder, 0, { from: nonFounder })
        )
    })

    it('allows founders to remove authorized addresses', async () => {
        await kycManager.removeAuthorizedAddress(nonFounder, 0)

        let authorized = await kycManager.authorized(nonFounder)

        assert.equal(
            authorized,
            false,
            'Founder unable to remove authorized addresses'
        )
    })

    it('disallows unauthorized addresses from adding approved addresses', async () => {
        let packedMessage = (nonAuthorized + SAMPLE_CHECK_ID)
        let signedMessage = await utils.signString(
            packedMessage,
            nonAuthorized,
            constants.privateKeys.nonParticipant
        )
        signedMessage = signedMessage.sig
        console.log('check1', packedMessage, nonAuthorized, SAMPLE_CHECK_ID, signedMessage)
        await utils.assertFail(
            kycManager.approveAddress(
                nonAuthorized,
                SAMPLE_CHECK_ID,
                signedMessage,
                { from: nonAuthorized }
            )
        )
    })

    it('disallows authorized addresses from removing non-approved addresses', async () => {
        await utils.assertFail(
            kycManager.removeApprovedAddress(nonAuthorized, 0, {
                from: nonFounder
            })
        )
    })

    it('disallows authorized addresses from adding approved addresses without a valid check ID and/or signed message', async () => {
        let signedMessage = 'invalid'
        await utils.assertFail(
            kycManager.approveAddress(
                nonAuthorized,
                SAMPLE_CHECK_ID,
                signedMessage,
                { from: nonFounder }
            )
        )
    })

    it('allows authorized addresses to add approved addresses with a valid check ID and signed message', async () => {
        let signedMessage = await utils.signString(
            nonAuthorized + SAMPLE_CHECK_ID,
            nonAuthorized,
            constants.privateKeys.nonParticipant
        )
        signedMessage = signedMessage.sig
        await utils.assertFail(
            kycManager.approveAddress(
                nonAuthorized,
                SAMPLE_CHECK_ID,
                signedMessage,
                { from: nonFounder }
            )
        )
    })

    it('disallows unauthorized addresses from removing approved addresses', async () => {
        await utils.assertFail(
            kycManager.removeApprovedAddress(nonAuthorized, 0, {
                from: nonAuthorized
            })
        )
    })

    it('allows authorized addresses to remove approved addresses', async () => {
        await utils.assertFail(
            kycManager.removeApprovedAddress(nonAuthorized, 0, {
                from: nonFounder
            })
        )
    })
})
