require('dotenv').config()

const NETWORK_DEVELOPMENT = 'development',
    NETWORK_RINKEBY = 'rinkeby',
    NETWORK_MAINNET = 'mainnet'

const HDWalletProvider = require('truffle-hdwallet-provider')

const mnemonic = process.env.MNEMONIC
const infuraKey = process.env.INFURA_KEY
const network = process.env.NETWORK

const IS_DOCKER = process.env.NODE_ENV === 'docker'
const HOST = IS_DOCKER ? 'ganache-cli' : 'localhost'
const LOCAL_NODE_URL = 'http://' + HOST + ':8545'

const networkUrl =
    network === NETWORK_DEVELOPMENT
        ? LOCAL_NODE_URL
        : network === NETWORK_RINKEBY
            ? 'https://rinkeby.infura.io/' + infuraKey
            : network === NETWORK_MAINNET
                ? 'https://mainnet.infura.io/' + infuraKey
                : LOCAL_NODE_URL

console.log('Network url', networkUrl, network)

const provider = new HDWalletProvider(mnemonic, networkUrl)

console.log(
    `Deploying with mnemonic '${mnemonic}' and infura key`,
    infuraKey,
    'address',
    provider.address
)

module.exports = {
    migrations_directory: './migrations',
    networks: {
        development: {
            host: HOST,
            port: 8545,
            network_id: '*', // Match any network id,
            from: provider.address,
            gas: '6721975',
            gasPrice: '100000000000'
        },
        rinkeby: {
            host: HOST,
            provider: provider,
            network_id: 4,
            from: provider.address,
            gas: '6721975',
            gasPrice: '5000000000'
        }
    }
}
