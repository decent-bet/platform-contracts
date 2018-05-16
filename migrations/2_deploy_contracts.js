const MultiSigWallet = artifacts.require('MultiSigWallet')
const DecentBetToken = artifacts.require('TestDecentBetToken')
const UpgradeAgent = artifacts.require('TestUpgradeAgent')
const House = artifacts.require('House')
const HouseAuthorizedController = artifacts.require('HouseAuthorizedController')
const HouseFundsController = artifacts.require('HouseFundsController')
const HouseLotteryController = artifacts.require('HouseLotteryController')
const HouseSessionsController = artifacts.require('HouseSessionsController')
const KycManager = artifacts.require('KycManager')
const BettingProvider = artifacts.require('BettingProvider')
const BettingProviderHelper = artifacts.require('BettingProviderHelper')
const SportsOracle = artifacts.require('SportsOracle')

const ECVerify = artifacts.require('ECVerify')
const SlotsChannelFinalizer = artifacts.require('SlotsChannelFinalizer')
const SlotsChannelManager = artifacts.require('SlotsChannelManager')
const SlotsHelper = artifacts.require('SlotsHelper')

const ethUtil = require('ethereumjs-util')
const Wallet = require('ethers').Wallet

const utils = require('../test/utils/utils')

const SAMPLE_APPLICANT_ID = '1030303-123123-123123'
const SAMPLE_CHECK_ID = '8546921-123123-123123'
const ORACLIZE_ADDRESS = '0x6f485C8BF6fc43eA212E93BBF8ce046C7f1cb475'

let getAccounts = () => {
    return new Promise((resolve, reject) => {
        web3.eth.getAccounts((err, _accounts) => {
            if (!err) resolve(_accounts)
            else reject()
        })
    })
}

let getTimestamp = async () => {
    let block = await web3.eth.getBlock('latest')
    return block.timestamp
}

let deploy = async (deployer, network) => {
    let decentBetMultisig
    let upgradeMaster, agentOwner
    let startTime, endTime
    let accounts = await getAccounts()
    web3.eth.defaultAccount = process.env.DEFAULT_ACCOUNT

    let signaturesRequired = 1
    let token,
        upgradeAgent,
        team,
        house,
        houseAuthorizedController,
        houseFundsController,
        houseLotteryController,
        houseSessionsController,
        kycManager,
        bettingProvider,
        bettingProviderHelper,
        sportsOracle,
        slotsHelper,
        slotsChannelFinalizer,
        slotsChannelManager

    let contractInfo = {}

    const getContractInstanceAndInfo = async contract => {
        let instance = await contract.deployed()
        contractInfo[contract.contractName] = await utils.getGasUsage(
            contract,
            deployer.network_id
        )
        return instance
    }

    console.log('Deploying with network', network)

    if (network === 'rinkeby' || network === 'development') {
        const timestamp = await getTimestamp()

        await deployer.deploy(
            MultiSigWallet,
            accounts.slice(0, 1),
            signaturesRequired
        )
        await getContractInstanceAndInfo(MultiSigWallet)

        upgradeMaster = accounts[0]
        team = accounts[0]
        decentBetMultisig = MultiSigWallet.address

        const ethPrice = 300
        const basePrice = ethPrice / 0.125

        startTime = timestamp + 2 * 24 * 60 * 60
        endTime = timestamp + 28 * 24 * 60 * 60

        try {
            // Deploy the DecentBetToken contract
            await deployer.deploy(
                DecentBetToken,
                decentBetMultisig,
                upgradeMaster,
                team,
                basePrice,
                startTime,
                endTime
            )
            token = await getContractInstanceAndInfo(DecentBetToken)

            // Deploy the ECVerify Library
            await deployer.deploy(ECVerify)

            await deployer.deploy(KycManager)
            kycManager = await getContractInstanceAndInfo(KycManager)

            // Deploy the House contract
            await deployer.deploy(House, token.address, kycManager.address)
            house = await getContractInstanceAndInfo(House)

            // Deploy House controller contracts
            await deployer.deploy(HouseAuthorizedController, house.address)
            houseAuthorizedController = await getContractInstanceAndInfo(
                HouseAuthorizedController
            )
            await house.setHouseAuthorizedControllerAddress(
                houseAuthorizedController.address
            )

            await deployer.deploy(HouseFundsController, house.address)
            houseFundsController = await getContractInstanceAndInfo(
                HouseFundsController
            )
            await house.setHouseFundsControllerAddress(
                houseFundsController.address
            )

            await deployer.deploy(HouseSessionsController, house.address)
            houseSessionsController = await getContractInstanceAndInfo(
                HouseSessionsController
            )
            await house.setHouseSessionsControllerAddress(
                houseSessionsController.address
            )

            // Deploy the Lottery contract
            await deployer.deploy(HouseLotteryController, ORACLIZE_ADDRESS)
            houseLotteryController = await getContractInstanceAndInfo(
                HouseLotteryController
            )

            // Set the house within the lottery contract
            await houseLotteryController.setHouse.sendTransaction(house.address)

            // Set the house lottery address within the house contract
            await house.setHouseLotteryControllerAddress.sendTransaction(
                houseLotteryController.address
            )

            // Deploy the BettingProviderHelper contract
            await deployer.deploy(BettingProviderHelper)
            bettingProviderHelper = await getContractInstanceAndInfo(
                BettingProviderHelper
            )

            // Deploy the BettingProvider contract
            await deployer.deploy(
                BettingProvider,
                token.address,
                house.address,
                houseAuthorizedController.address,
                bettingProviderHelper.address,
                {
                    gas: 6720000
                }
            )
            bettingProvider = await getContractInstanceAndInfo(BettingProvider)

            // Deploy the SportsOracle contract
            await deployer.deploy(SportsOracle, token.address)
            sportsOracle = await getContractInstanceAndInfo(SportsOracle)

            // Link the ECVerify Library to the SlotsChannelManager contract
            await deployer.link(ECVerify, SlotsChannelManager)

            // Deploy the SlotsHelper contract
            await deployer.deploy(SlotsHelper)
            slotsHelper = await getContractInstanceAndInfo(SlotsHelper)

            // Deploy the SlotsChannelFinalizer contract
            await deployer.deploy(
                SlotsChannelFinalizer,
                slotsHelper.address,
                kycManager.address
            )
            slotsChannelFinalizer = await getContractInstanceAndInfo(
                SlotsChannelFinalizer
            )

            // Deploy the SlotsChannelManager contract
            await deployer.deploy(
                SlotsChannelManager,
                house.address,
                token.address,
                slotsHelper.address,
                slotsChannelFinalizer.address,
                kycManager.address
            )
            slotsChannelManager = await getContractInstanceAndInfo(
                SlotsChannelManager
            )

            // Set SlotsChannelManager within the SlotsChannelFinalizer contract
            await slotsChannelFinalizer.setSlotsChannelManager.sendTransaction(
                slotsChannelManager.address
            )

            // Add BettingProvider as a house offering
            await houseSessionsController.addHouseOffering.sendTransaction(
                bettingProvider.address,
                {
                    gas: 3000000
                }
            )

            // Add SlotsChannelManager as a house offering
            await houseSessionsController.addHouseOffering.sendTransaction(
                slotsChannelManager.address,
                {
                    gas: 3000000
                }
            )

            await kycManager.addKycEnabledContract(house.address)
            await kycManager.addKycEnabledContract(slotsChannelManager.address)

            // Approve first 9 accounts obtained from mnemonic
            let wallet
            for (let i = 0; i < 9; i++) {
                wallet = Wallet.fromMnemonic(process.env.MNEMONIC, "m/44'/60'/0'/0/" + i)
                let signedMessage = await utils.signString(
                    SAMPLE_APPLICANT_ID,
                    accounts[i],
                    wallet.privateKey
                )
                const v = signedMessage.v
                const r = ethUtil.bufferToHex(signedMessage.r)
                const s = ethUtil.bufferToHex(signedMessage.s)

                console.log('Approving address', accounts[i])

                await kycManager.approveAddress(
                    house.address,
                    accounts[i],
                    SAMPLE_APPLICANT_ID,
                    SAMPLE_CHECK_ID,
                    v,
                    r,
                    s
                )

                await kycManager.approveAddress(
                    slotsChannelManager.address,
                    accounts[i],
                    SAMPLE_APPLICANT_ID,
                    SAMPLE_CHECK_ID,
                    v,
                    r,
                    s
                )
            }

            console.log(
                'Deployed:',
                '\nToken: ' + token.address,
                '\nHouse: ' + house.address,
                '\nHouseFundsController: ' + houseFundsController.address,
                '\nHouseAuthorizedController: ' +
                    houseAuthorizedController.address,
                '\nHouseSessionsController: ' + houseSessionsController.address,
                '\nHouseLottery: ' + houseLotteryController.address,
                '\nKycManager: ' + kycManager.address,
                '\nSlotsChannelManager: ' + SlotsChannelManager.address,
                '\nBettingProviderHelper: ' + bettingProviderHelper.address,
                '\nBettingProvider: ' + bettingProvider.address,
                '\nSports Oracle: ' + sportsOracle.address,
                '\nSlotsChannelFinalizer: ' + slotsChannelFinalizer.address,
                '\n\nContract info:\n',
                contractInfo
            )
        } catch (e) {
            console.log('Error deploying contracts', e.message)
        }
    } else if (network === 'mainnet') {
        try {
            await MultiSigWallet.at(utils.multisigWalletAddressMainNet)
            upgradeMaster = web3.eth.accounts[0]
            agentOwner = upgradeMaster
            decentBetMultisig = MultiSigWallet.address
            let startBlock = startBlockMainNet
            let endBlock = endBlockMainNet
            await deployer.deploy(
                DecentBetToken,
                decentBetMultisig,
                upgradeMaster,
                startBlock,
                endBlock
            )
            token = await DecentBetToken.deployed()

            // Deploy UpgradeAgent contract
            let gasEstimate = 2000000
            await deployer.deploy(UpgradeAgent, token.address, {
                from: agentOwner,
                gas: gasEstimate + utils.gasEpsilon
            })
            upgradeAgent = await UpgradeAgent.deployed()
            await token.setUpgradeAgent(upgradeAgent.address)
        } catch (e) {
            console.log('Error deploying contracts', e.message)
        }
    }
}

module.exports = function(deployer, network) {
    // Work-around to stage tasks in the migration script and not actually run them
    // https://github.com/trufflesuite/truffle/issues/501#issuecomment-332589663
    deployer.then(() => deploy(deployer, network))
}
