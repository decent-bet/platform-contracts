const BigNumber = require('bignumber.js')
const ethUtil = require('ethereumjs-util')

let constants = require('./utils/constants')
let contracts = require('./utils/contracts')
let utils = require('./utils/utils')

let wallet
let token
let house
let houseSessionsController
let bettingProvider
let slotsChannelManager
let kycManager

let founder
let nonFounder
let nonAuthorized

const SAMPLE_APPROVAL_ID = '5b00158631f075a494163e06'
const SAMPLE_CHECK_ID = '8546921-123123-123123'
const SAMPLE_APPLICANT_ID = '1030303-123123-123123'

let isMockTime

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

contract('KYC Manager', accounts => {
    console.log('Accounts', accounts)
    it('initializes kyc contract', async () => {
        founder = accounts[0]
        nonFounder = accounts[1]
        nonAuthorized = accounts[2]

        wallet = await contracts.MultiSigWallet.deployed()
        token = await contracts.DecentBetToken.deployed()
        house = await contracts.House.deployed()
        houseSessionsController = await contracts.HouseSessionsController.deployed()
        bettingProvider = await contracts.BettingProvider.deployed()
        slotsChannelManager = await contracts.SlotsChannelManager.deployed()
        kycManager = await contracts.KycManager.deployed()

        isMockTime = await house.isMock()

        await token.ownerFaucet()

        // Check if house token is correct DBET token
        let houseToken = await house.decentBetToken()
        assert.equal(
            token.address,
            houseToken,
            'Invalid token address in house'
        )

        // Begin session zero
        await house.beginNextSession()

        // Redeem the owner faucet
        await token.ownerFaucet()

        // Approve and purchase credits
        const houseCreditsAmount = '50000000000000000000000000'
        await token.approve(house.address, houseCreditsAmount, {
            from: founder
        })

        await house.purchaseCredits(houseCreditsAmount, { from: founder })

        // Deposit allocated tokens in the final week of session zero
        const oneWeek = 7 * 24 * 60 * 60
        await timeTravel(oneWeek)

        // Allocate 50% of tokens to both offerings
        await house.allocateTokensForHouseOffering(50, bettingProvider.address)
        await house.allocateTokensForHouseOffering(
            50,
            slotsChannelManager.address
        )

        // Finalize Token allocations
        await house.finalizeTokenAllocations()

        // Deposit allocated tokens to offerings
        await house.depositAllocatedTokensToHouseOffering(
            bettingProvider.address,
            { from: founder }
        )
        await house.depositAllocatedTokensToHouseOffering(
            slotsChannelManager.address,
            { from: founder }
        )

        // Begin session one
        await timeTravel(oneWeek)
        await house.beginNextSession()

        // Check if house session is one
        let currentSession = await house.currentSession()
        currentSession = currentSession.toNumber()
        assert.equal(currentSession, 1, 'Invalid current session number')

        // Check if first offering is BettingProvider
        let firstOffering = await houseSessionsController.offeringAddresses(0)
        assert.equal(
            bettingProvider.address,
            firstOffering,
            'Invalid betting provider offering address'
        )

        // Check if second offering is SlotsChannelManager
        let secondOffering = await houseSessionsController.offeringAddresses(1)
        assert.equal(
            slotsChannelManager.address,
            secondOffering,
            'Invalid slots channel manager offering address'
        )

        // Check if deposited amounts for slots and betting provider are correct
        let depositedAmount = new BigNumber(houseCreditsAmount)
            .dividedBy(2)
            .toFixed()

        let slotsDeposit = await slotsChannelManager.balanceOf(
            slotsChannelManager.address,
            currentSession
        )
        let bettingProviderDeposit = await bettingProvider.balanceOf(
            bettingProvider.address,
            currentSession
        )

        assert.equal(
            slotsDeposit.toFixed(),
            depositedAmount,
            'Invalid slots deposit amount'
        )

        assert.equal(
            bettingProviderDeposit.toFixed(),
            depositedAmount,
            'Invalid betting provider deposit amount'
        )

        let bettingProviderSession = await bettingProvider.currentSession()
        let slotsChannelManagerSession = await slotsChannelManager.currentSession()

        assert.equal(
            bettingProviderSession.toNumber(),
            1,
            'Invalid betting provider session'
        )
        assert.equal(
            slotsChannelManagerSession.toNumber(),
            1,
            'Invalid slots channel manager session'
        )

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
    it('disallows non-authorized addresses from removing approved addresses', async () => {
        await utils.assertFail(
            kycManager.removeApprovedAddress(nonAuthorized, {
                from: nonAuthorized
            })
        )
    })

    it('allows authorized addresses to remove approved addresses', async () => {
        await kycManager.removeApprovedAddress(nonAuthorized, {
            from: founder
        })
        let approved = await kycManager.isKYCVerified(nonAuthorized)
        assert.equal(approved, false, 'Address was not removed from approvals')
    })

    it('disallows authorized addresses from removing non-approved addresses', async () => {
        await utils.assertFail(
            kycManager.removeApprovedAddress(nonAuthorized, {
                from: founder
            })
        )
    })

    it('disallows non-authorized addresses from adding approved addresses', async () => {
        let signedMessage = await utils.signString(
            SAMPLE_APPROVAL_ID,
            nonAuthorized,
            constants.privateKeys.nonParticipant
        )
        const v = signedMessage.v
        const r = ethUtil.bufferToHex(signedMessage.r)
        const s = ethUtil.bufferToHex(signedMessage.s)

        await utils.assertFail(
            kycManager.approveAddress(
                nonAuthorized,
                SAMPLE_APPROVAL_ID,
                v,
                r,
                s,
                {
                    from: nonAuthorized
                }
            )
        )
    })

    it('disallows authorized addresses from adding approved addresses without a valid check ID and/or signed message', async () => {
        let v = 27
        let r = '0x'
        let s = '0x'
        await utils.assertFail(
            kycManager.approveAddress(
                nonAuthorized,
                SAMPLE_APPROVAL_ID,
                v,
                r,
                s,
                {
                    from: founder
                }
            )
        )
    })

    it('allows authorized addresses to add approved addresses with a valid approval ID and signed message', async () => {
        let signedMessage = await utils.signString(
            SAMPLE_APPROVAL_ID,
            nonAuthorized,
            constants.privateKeys.nonParticipant
        )
        const v = signedMessage.v
        const r = ethUtil.bufferToHex(signedMessage.r)
        const s = ethUtil.bufferToHex(signedMessage.s)

        await kycManager.approveAddress(
            nonAuthorized,
            SAMPLE_APPROVAL_ID,
            v,
            r,
            s,
            { from: founder }
        )

        let approved = await kycManager.isKYCVerified(nonAuthorized)
        assert.equal(approved, true, 'Non authorized has not been approved')
    })

    it('disallows authorized addresses from approving addresses for enhanced KYC with invalid application and/or check IDs', async () => {
        // Incorrect signed message - should fail
        let signedMessage = await utils.signString(
            SAMPLE_APPROVAL_ID,
            nonAuthorized,
            constants.privateKeys.nonParticipant
        )
        const v = signedMessage.v
        const r = ethUtil.bufferToHex(signedMessage.r)
        const s = ethUtil.bufferToHex(signedMessage.s)

        await utils.assertFail(
            kycManager.approveAddressWithEnhancedKYC(
                nonAuthorized,
                SAMPLE_APPLICANT_ID,
                SAMPLE_CHECK_ID,
                v,
                r,
                s,
                {
                    from: founder
                }
            )
        )
    })

    it('disallows non-authorized addresses from approving addresses for enhanced KYC', async () => {
        // Incorrect signed message - should fail
        let signedMessage = await utils.signString(
            SAMPLE_APPLICANT_ID,
            nonAuthorized,
            constants.privateKeys.nonParticipant
        )
        const v = signedMessage.v
        const r = ethUtil.bufferToHex(signedMessage.r)
        const s = ethUtil.bufferToHex(signedMessage.s)

        await utils.assertFail(
            kycManager.approveAddressWithEnhancedKYC(
                nonAuthorized,
                SAMPLE_APPLICANT_ID,
                SAMPLE_CHECK_ID,
                v,
                r,
                s,
                { from: nonAuthorized }
            )
        )
    })

    it('allows authorized addresses to approve addresses with enhanced KYC', async () => {
        let signedMessage = await utils.signString(
            SAMPLE_APPLICANT_ID,
            nonAuthorized,
            constants.privateKeys.nonParticipant
        )
        const v = signedMessage.v
        const r = ethUtil.bufferToHex(signedMessage.r)
        const s = ethUtil.bufferToHex(signedMessage.s)

        await kycManager.approveAddressWithEnhancedKYC(
            nonAuthorized,
            SAMPLE_APPLICANT_ID,
            SAMPLE_CHECK_ID,
            v,
            r,
            s,
            { from: founder }
        )

        let approved = await kycManager.isEnhancedKYCVerified(nonAuthorized)
        assert.equal(
            approved,
            true,
            'Non authorized has not been approved with enhanced KYC'
        )
    })

    it('disallows authorized address from adding enhanced KYC addresses to timeout blacklist', async () => {
        await utils.assertFail(
            kycManager.addToTimeoutBlacklist(nonAuthorized),
            { from: founder }
        )
    })

    it('disallows non-authorized addresses from adding addresses to timeout blacklist', async () => {
        // Remove and add address to get rid of enhanced KYC verification
        await kycManager.removeApprovedAddress(nonAuthorized, {
            from: founder
        })
        let approved = await kycManager.isKYCVerified(nonAuthorized)
        assert.equal(approved, false, 'Address was not removed from approvals')

        // Re-approve address
        let signedMessage = await utils.signString(
            SAMPLE_APPROVAL_ID,
            nonAuthorized,
            constants.privateKeys.nonParticipant
        )
        const v = signedMessage.v
        const r = ethUtil.bufferToHex(signedMessage.r)
        const s = ethUtil.bufferToHex(signedMessage.s)

        await kycManager.approveAddress(
            nonAuthorized,
            SAMPLE_APPROVAL_ID,
            v,
            r,
            s,
            { from: founder }
        )

        approved = await kycManager.isKYCVerified(nonAuthorized)
        assert.equal(approved, true, 'Non authorized has not been approved')

        // Make sure the address is not enhanced KYC verified after being removed and re-added
        let isEnhancedKYCVerified = await kycManager.isEnhancedKYCVerified(
            nonAuthorized
        )
        assert.equal(
            isEnhancedKYCVerified,
            false,
            'Non authorized has been approved with enhanced KYC'
        )

        await utils.assertFail(
            kycManager.addToTimeoutBlacklist(nonAuthorized, {
                from: nonAuthorized
            })
        )
    })

    it('allows authorized addresses to add addresses to timeout blacklist', async () => {
        await kycManager.addToTimeoutBlacklist(nonAuthorized)

        let areWithdrawalsAllowed = await kycManager.areWithdrawalsAllowed(
            nonAuthorized
        )
        assert.equal(
            areWithdrawalsAllowed,
            false,
            'Withdrawals are allowed even after being added to timeout blacklist'
        )
    })

    it('disallows non-authorized addresses from updating non enhanced KYC limit', async () => {
        let ether = new BigNumber(10).exponentiatedBy(18)
        let limit = ether
            .multipliedBy(constants.BTC_KYC_LIMIT)
            .dividedBy(constants.DBET_BTC)
            .toFixed(0)
        await utils.assertFail(
            kycManager.updateDbetsNonEnhancedKycLimit(limit, {
                from: nonAuthorized
            })
        )
    })

    it('allows authorized addresses to update non enhanced KYC limit', async () => {
        let ether = new BigNumber(10).exponentiatedBy(18)
        let limit = ether
            .multipliedBy(constants.BTC_KYC_LIMIT)
            .dividedBy(constants.DBET_BTC)
            .toFixed(0)
        await kycManager.updateDbetsNonEnhancedKycLimit(limit)

        let dbetsNonEnhancedKycLimit = await kycManager.dbetsNonEnhancedKycLimit()
        dbetsNonEnhancedKycLimit = dbetsNonEnhancedKycLimit.toFixed(0)

        assert.equal(
            dbetsNonEnhancedKycLimit,
            limit,
            'Invalid DBET non-enhanced KYC limit in contract'
        )
    })

    it('Disallows timeout blacklisted users from withdrawing from house/offerings', async () => {
        await token.faucet({ from: nonAuthorized })

        let preDepositTokenBalance = await token.balanceOf(nonAuthorized)

        // Approve and deposit
        await token.approve(
            slotsChannelManager.address,
            preDepositTokenBalance,
            { from: nonAuthorized }
        )
        await slotsChannelManager.deposit(preDepositTokenBalance, {
            from: nonAuthorized
        })

        let ether = new BigNumber(10).exponentiatedBy(18)
        let withdrawAmount = ether
            .multipliedBy(50)
            .times(1000)
            .toFixed(0)

        let currentSession = await slotsChannelManager.currentSession()
        await utils.assertFail(
            slotsChannelManager.withdraw(withdrawAmount, currentSession, {
                from: nonAuthorized
            })
        )

        // Go 1 day in the future to lift timeout blacklist
        await timeTravel(24 * 60 * 60 + 60)

        await slotsChannelManager.withdraw(withdrawAmount, currentSession, {
            from: nonAuthorized
        })

        let postWithdrawTokenBalance = await token.balanceOf(nonAuthorized)

        assert.equal(
            postWithdrawTokenBalance.toFixed(),
            preDepositTokenBalance.minus(withdrawAmount).toFixed(),
            'Invalid token balance after withdrawal'
        )
    })

    it('disallows non-authorized addresses from adding addresses to blacklist', async () => {
        await utils.assertFail(
            kycManager.addToBlacklist(nonAuthorized, { from: nonAuthorized })
        )
    })

    it('allows authorized address to add addresses to blacklist', async () => {
        await kycManager.addToBlacklist(nonAuthorized)
        let isBlacklisted = await kycManager.blacklist(nonAuthorized)

        assert.equal(isBlacklisted, true, 'Address was not blacklisted')
    })

    it('Does not allow blacklisted users to interact with house/offering contracts', async () => {
        // Slots

        // Create channel
        let initialDeposit = new BigNumber(10)
            .exponentiatedBy(18)
            .times(1000)
            .toFixed()
        await utils.assertFail(
            slotsChannelManager.createChannel(initialDeposit, {
                from: nonAuthorized
            })
        )

        // Deposit
        await token.approve(slotsChannelManager.address, initialDeposit, {
            from: nonAuthorized
        })
        await utils.assertFail(
            slotsChannelManager.deposit(initialDeposit, {
                from: nonAuthorized
            })
        )

        // Withdraw
        let currentSession = await slotsChannelManager.currentSession()
        await utils.assertFail(
            slotsChannelManager.withdraw(currentSession, initialDeposit, {
                from: nonAuthorized
            })
        )

        // House
    })

    it('disallows non-authorized addresses from removing addresses from blacklist', async () => {
        await utils.assertFail(
            kycManager.removeFromBlacklist(nonAuthorized, {
                from: nonAuthorized
            })
        )
    })

    it('allows authorized address to remove addresses from blacklist', async () => {
        await kycManager.removeFromBlacklist(nonAuthorized)

        let isBlacklisted = await kycManager.blacklist(nonAuthorized)

        assert.equal(
            isBlacklisted,
            false,
            'Address was not removed from blacklist by an authorized address'
        )
    })
})
