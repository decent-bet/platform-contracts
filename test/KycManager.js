const ethUtil = require('ethereumjs-util')

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
const SAMPLE_APPLICANT_ID = '1030303-123123-123123'

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
            kycManager.removeAuthorizedAddress(nonFounder, 0, {
                from: nonFounder
            })
        )
    })

    it('allows founders to remove authorized addresses', async () => {
        await kycManager.removeAuthorizedAddress(nonFounder, 1)
        let authorized = await kycManager.authorized(nonFounder)

        assert.equal(
            authorized,
            false,
            'Founder unable to remove authorized addresses'
        )
    })

    // Since migration script adds all available mnemonic addresses to approved list, remove it from the list first
    it('disallows unauthorized addresses from removing approved addresses', async () => {
        await utils.assertFail(
            kycManager.removeApprovedAddress(nonAuthorized, 2, {
                from: nonAuthorized
            })
        )
    })

    it('allows authorized addresses to remove approved addresses', async () => {
        let address = await kycManager.approvedAddressList(2)
        console.log('Approved address', address, nonAuthorized)

        await kycManager.removeApprovedAddress(nonAuthorized, 2, {
            from: founder
        })
        let approved = await kycManager.approved(nonAuthorized)
        assert.equal(
            approved,
            false,
            'Address was not removed from approved list'
        )
    })

    it('disallows authorized addresses from removing non-approved addresses', async () => {
        await utils.assertFail(
            kycManager.removeApprovedAddress(nonAuthorized, 2, {
                from: founder
            })
        )
    })

    it('disallows unauthorized addresses from adding approved addresses', async () => {
        let signedMessage = await utils.signString(
            SAMPLE_APPLICANT_ID,
            nonAuthorized,
            constants.privateKeys.nonParticipant
        )
        const v = signedMessage.v
        const r = ethUtil.bufferToHex(signedMessage.r)
        const s = ethUtil.bufferToHex(signedMessage.s)

        await utils.assertFail(
            kycManager.approveAddress(nonAuthorized, SAMPLE_APPLICANT_ID, SAMPLE_CHECK_ID, v, r, s, {
                from: nonAuthorized
            })
        )
    })

    it('disallows authorized addresses from adding approved addresses without a valid check ID and/or signed message', async () => {
        let v = 27
        let r = '0x'
        let s = '0x'
        await utils.assertFail(
            kycManager.approveAddress(nonAuthorized, SAMPLE_APPLICANT_ID, SAMPLE_CHECK_ID, v, r, s, {
                from: founder
            })
        )
    })

    it('allows authorized addresses to add approved addresses with a valid check ID and signed message', async () => {
        let signedMessage = await utils.signString(
            SAMPLE_APPLICANT_ID,
            nonAuthorized,
            constants.privateKeys.nonParticipant
        )
        const v = signedMessage.v
        const r = ethUtil.bufferToHex(signedMessage.r)
        const s = ethUtil.bufferToHex(signedMessage.s)

        await kycManager.approveAddress(
            nonAuthorized,
            SAMPLE_APPLICANT_ID,
            SAMPLE_CHECK_ID,
            v,
            r,
            s,
            { from: founder }
        )

        let approved = await kycManager.approved(nonAuthorized)
        assert.equal(approved, true, 'Non authorized has not been approved')
    })
})
