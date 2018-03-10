let utils = require('./utils/utils.js')

let MultiSigWallet = artifacts.require('MultiSigWallet')
let DecentBetToken = artifacts.require('TestDecentBetToken')
let SlotsChannelManager = artifacts.require('IndependentSlotsChannelManager')
let SlotsChannelFinalizer = artifacts.require(
    'IndependentSlotsChannelFinalizer'
)
let SlotsHelper = artifacts.require('SlotsHelper')

let wallet
let token
let slotsChannelManager
let slotsChannelFinalizer
let slotsHelper

let owner
let nonOwner
let otherNonOwner

let channelId

contract('IndependentSlotsChannelManager', accounts => {
    it('initializes independent slots channel manager contract', async () => {
        owner = accounts[0]
        nonOwner = accounts[1]
        otherNonOwner = accounts[2]

        wallet = await MultiSigWallet.deployed()
        token = await DecentBetToken.deployed()
        slotsChannelManager = await SlotsChannelManager.deployed()
        slotsChannelFinalizer = await SlotsChannelFinalizer.deployed()
        slotsHelper = await SlotsHelper.deployed()

        let _owner = await slotsChannelManager.owner()
        assert.equal(owner, _owner, 'Invalid owner')

        let slotsToken = await slotsChannelManager.decentBetToken()
        let _slotsHelper = await slotsChannelManager.slotsHelper()

        console.log(token.address, slotsToken)
        assert.equal(
            token.address,
            slotsToken,
            'Invalid token address in SlotsChannelManager'
        )

        assert.equal(_owner, owner, 'Invalid owner in SlotsChannelManager')

        assert.equal(
            slotsHelper.address,
            _slotsHelper,
            'Invalid slots helper contract address'
        )
    })

    it('disallows owner from adding already authorized addresses', async () => {
        await utils.assertFail(
            slotsChannelManager.addToAuthorizedAddresses.sendTransaction(
                owner,
                {
                    from: owner
                }
            )
        )
    })

    it('disallows non-owners from adding authorized addresses', async () => {
        await utils.assertFail(
            slotsChannelManager.addToAuthorizedAddresses.sendTransaction(
                nonOwner,
                {
                    from: nonOwner
                }
            )
        )
    })

    it('allows owners to add authorized addresses', async () => {
        await slotsChannelManager.addToAuthorizedAddresses.sendTransaction(
            nonOwner,
            {
                from: owner
            }
        )

        let authorized = await slotsChannelManager.authorized(owner)
        assert.equal(
            authorized,
            true,
            'Owner should be allowed to add authorized addresses'
        )
    })

    it('disallows non-owners from removing authorized addresses', async () => {
        await utils.assertFail(
            slotsChannelManager.removeFromAuthorizedAddresses.sendTransaction(
                nonOwner,
                {
                    from: nonOwner
                }
            )
        )
    })

    it('allows owners to remove authorized addresses', async () => {
        await slotsChannelManager.removeFromAuthorizedAddresses.sendTransaction(
            nonOwner,
            {
                from: owner
            }
        )

        let authorized = await slotsChannelManager.authorized(nonOwner)
        assert.equal(
            authorized,
            false,
            'Owner should be allowed to remove authorized addresses'
        )
    })

    it('disallows owners from removing unauthorized addresses', async () => {
        await utils.assertFail(
            slotsChannelManager.removeFromAuthorizedAddresses.sendTransaction(
                nonOwner,
                {
                    from: owner
                }
            )
        )
    })

    it('disallows unauthorized addresses from creating authorized deposits', async () => {
        // Retrieve DBETs in non-owner address
        await token.faucet({ from: nonOwner })

        let faucetTokens = '10000000000000000000000'
        let tokenBalance = await token.balanceOf(nonOwner, { from: nonOwner })
        assert.equal(
            tokenBalance.toFixed(),
            faucetTokens,
            'Invalid balance after retrieving faucet tokens'
        )

        await token.approve(
            tokenBalance.toFixed(),
            slotsChannelManager.address,
            { from: nonOwner }
        )

        await utils.assertFail(
            slotsChannelManager.authorizedDeposit.sendTransaction(
                faucetTokens,
                {
                    from: nonOwner
                }
            )
        )
    })

    it('allows authorized addresses to create authorized deposits', async () => {
        // Retrieve DBETs in non-owner address
        await token.faucet({ from: owner })

        let faucetTokens = '10000000000000000000000'
        let tokenBalance = await token.balanceOf(owner, { from: owner })
        assert.equal(
            tokenBalance.toFixed(),
            faucetTokens,
            'Invalid balance after retrieving faucet tokens'
        )

        await token.approve(
            slotsChannelManager.address,
            tokenBalance.toFixed(),
            { from: owner }
        )

        let allowance = await token.allowance(
            owner,
            slotsChannelManager.address
        )
        assert.equal(
            allowance.toFixed(),
            tokenBalance.toFixed(),
            'Invalid allowance'
        )

        await slotsChannelManager.authorizedDeposit.sendTransaction(
            faucetTokens,
            {
                from: owner
            }
        )

        let slotsBalance = await slotsChannelManager.balanceOf(
            slotsChannelManager.address
        )

        assert.equal(
            faucetTokens,
            slotsBalance.toFixed(),
            'SlotsChannelManager has incorrect balance after authorized deposit'
        )
    })

    it('disallows unauthorized addresses from withdrawing contract deposits', async () => {
        await utils.assertFail(
            slotsChannelManager.authorizedWithdraw.sendTransaction({
                from: nonOwner
            })
        )
    })

    it('allows authorized addresses to withdraw contract deposits', async () => {
        let ownerBalance = await token.balanceOf(owner)
        let tokenBalance = await slotsChannelManager.balanceOf(
            slotsChannelManager.address
        )

        await slotsChannelManager.authorizedWithdraw.sendTransaction({
            from: owner
        })

        let finalOwnerBalance = await token.balanceOf(owner)
        let finalContractDepositedTokenBalance = await slotsChannelManager.balanceOf(
            slotsChannelManager.address
        )
        let finalContractTokenBalance = await token.balanceOf(
            slotsChannelManager.address
        )

        assert.equal(
            finalContractDepositedTokenBalance.toFixed(),
            0,
            'Invalid final contract deposited token balance after withdrawal'
        )
        assert.equal(
            finalContractTokenBalance.toFixed(),
            0,
            'Invalid final contract token balance after withdrawal'
        )

        assert.equal(
            ownerBalance.plus(tokenBalance).toFixed(),
            finalOwnerBalance.toFixed(),
            'Invalid owner balance after contract withdrawal'
        )
    })

    it('disallows users from depositing without sufficient deposited token balance', async () => {
        await token.faucet({ from: nonOwner })
        let tokenBalance = await token.balanceOf(nonOwner)

        await utils.assertFail(
            slotsChannelManager.deposit.sendTransaction(
                tokenBalance.toFixed() + 1,
                {
                    from: nonOwner
                }
            )
        )
    })

    it('allows users to deposit if deposited token balance is sufficient', async () => {
        let tokenBalance = await token.balanceOf(nonOwner)
        console.log('Token balance', tokenBalance.toFixed())

        await token.approve(
            slotsChannelManager.address,
            tokenBalance.toFixed(),
            { from: nonOwner }
        )

        await slotsChannelManager.deposit.sendTransaction(
            tokenBalance.toFixed(),
            {
                from: nonOwner
            }
        )
    })

    it('disallows users from creating channels out of hardcoded initial deposit range', async () => {
        let outOfHigherRange = '1001000000000000000000'
        let outOfLowerRange = '99000000000000000000'

        await utils.assertFail(
            slotsChannelManager.createChannel.sendTransaction(
                outOfHigherRange,
                {
                    from: nonOwner
                }
            )
        )

        await utils.assertFail(
            slotsChannelManager.createChannel.sendTransaction(outOfLowerRange, {
                from: nonOwner
            })
        )
    })

    it('disallows users from creating channels without a sufficient deposited token balance', async () => {
        let initialDeposit = '500000000000000000000'

        await utils.assertFail(
            slotsChannelManager.createChannel.sendTransaction(initialDeposit, {
                from: otherNonOwner
            })
        )
    })

    it('allows users to create channels with a sufficient balance', async () => {
        let initialDeposit = '500000000000000000000'

        let balance = await slotsChannelManager.balanceOf(nonOwner)
        console.log('User Balance', balance)

        await slotsChannelManager.createChannel.sendTransaction(
            initialDeposit,
            {
                from: nonOwner
            }
        )

        let channelCount = await slotsChannelManager.channelCount()
        channelId = channelCount.toNumber() - 1
    })

    it('disallows transferTokensToChannel call from outside contract', async () => {
        assert.equal(
            slotsChannelManager.transferTokensToChannel,
            undefined,
            'transferTokensToChannel must be inaccessible from contract instance'
        )
    })

    it('disallows non players from depositing in channels', async () => {
        let initialUserNumber = 1
        let finalUserHash = 'abc'
        await utils.assertFail(
            slotsChannelManager.depositChannel.sendTransaction(
                channelId,
                initialUserNumber,
                finalUserHash,
                { from: otherNonOwner }
            )
        )
    })

    it(
        'disallows players from depositing in channels with invalid data if not ready '
    )

    it('allows players to deposit in channels with valid data if not ready', async () => {})

    it('disallows authorized addresses from activating a channel when the user is not ready', async () => {})

    it('disallows players from depositing in channels if ready', async () => {})

    it('disallows unauthorized addresses from activating a channel', async () => {})

    it('allows authorized addresses to activate a channel if user is ready', async () => {})

    it('disallows authorized addresses from activating a channel if already activated', async () => {})

    it('disallows non participants from finalizing a channel', async () => {})

    it('disallows participants from finalizing a channel with invalid data', async () => {})

    it('disallows participants from claiming a channel before it closes', async () => {})

    it('allows participants to close a channel with valid data', async () => {})

    it('allows participants to claim a channel after it closes', async () => {})
})
