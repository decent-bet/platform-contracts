pragma solidity 0.4.21;

import "./SlotsImplementation.sol";
import "./SlotsHelper.sol";
import "../../Token/ERC20.sol";
import "../../House/House.sol";
import "../../House/Controllers/HouseAuthorizedController.sol";
import "../../House/Controllers/HouseSessionsController.sol";
import "../../House/HouseOffering.sol";

import "../../Libraries/ECVerify.sol";
import "../../Libraries/SafeMath.sol";
import "../../Libraries/strings.sol";
import "../../Libraries/Utils.sol";

import "../../Kyc/KycManager.sol";

// A State channel contract to handle slot games on the Decent.bet platform
contract SlotsChannelManager is SlotsImplementation, HouseOffering, SafeMath, Utils {

    using strings for *;
    using ECVerify for *;

    /* Slot specific */

    // 5 DBETs minimum deposit. Minimum 1 spin (@ 5 DBETs per spin), Maximum 500 spins (@0.01 DBET per spin)
    uint constant MIN_DEPOSIT = 5 ether;

    // 5000 DBETs maximum deposit. Minimum 1000 spins (@ 5 DBETs per spin), Maximum 500000 spins (@0.01 DBET per spin)
    uint constant MAX_DEPOSIT = 5000 ether;

    /* END */

    /* Variables */

    // Address of the house contract - passed through during contract creation
    address public houseAddress;

    // Address of the slots channel finalizer contract - passed through during contract creation
    address public slotsChannelFinalizer;

    // Used to create incremented channel ids.
    uint public channelCount;

    // Current house session.
    uint public currentSession;

    /* Contracts */
    ERC20 decentBetToken;

    House house;
    HouseAuthorizedController houseAuthorizedController;
    HouseSessionsController houseSessionsController;
    SlotsHelper slotsHelper;
    KycManager kycManager;

    /* Mappings */

    // Channels created.
    mapping (bytes32 => Channel) channels;

    // Amount of DBETs deposited by user and house for a channel.
    mapping (bytes32 => mapping(bool => uint)) public channelDeposits;

    // Finalized balances for user and house for a channel.
    mapping (bytes32 => mapping(bool => uint)) public finalBalances;

    // Addresses of the players involved - false = user, true = house for a channel.
    mapping (bytes32 => mapping(bool => address)) public players;

    // Users need to deposit/withdraw tokens for a session with the provider before creating channels.
    // These can be withdrawn at any time.
    // mapping (userAddress => mapping (sessionNumber => amount))
    mapping (address => mapping (uint => uint)) public depositedTokens;

    /* Events */
    event LogNewChannel(
        bytes32 id,
        address indexed user,
        uint initialDeposit,
        uint timestamp
    );

    event LogChannelFinalized(
        bytes32 indexed id,
        bool isHouse
    );

    event LogChannelDeposit(
        bytes32 indexed id,
        address user,
        string finalUserHash
    );

    event LogChannelActivate(
        bytes32 indexed id,
        address user,
        string finalSeedHash,
        string finalReelHash
    );

    event LogClaimChannelTokens(
        bytes32 indexed id,
        bool isHouse,
        uint timestamp
    );

    event LogDeposit(
        address _address,
        uint amount,
        uint session,
        uint balance
    );

    event LogWithdraw(
        address _address,
        uint amount,
        uint session,
        uint balance
    );

    /* Constructor */

    function SlotsChannelManager(
        address _house,
        address _token,
        address _slotsHelper,
        address _slotsChannelFinalizer,
        address _kycManager
    )
    public {
        require(_house != 0x0);
        require(_token != 0x0);
        require(_slotsHelper != 0x0);
        require(_slotsChannelFinalizer != 0x0);
        require(_kycManager != 0x0);

        houseAddress = _house;
        decentBetToken = ERC20(_token);
        house = House(_house);
        kycManager = KycManager(_kycManager);

        address houseAuthorizedControllerAddress;
        address houseSessionsControllerAddress;

        (houseAuthorizedControllerAddress,, houseSessionsControllerAddress) = house.getHouseControllers();

        require(houseAuthorizedControllerAddress != 0x0);
        require(houseSessionsControllerAddress != 0x0);

        houseAuthorizedController = HouseAuthorizedController(houseAuthorizedControllerAddress);
        houseSessionsController   = HouseSessionsController(houseSessionsControllerAddress);

        slotsHelper = SlotsHelper(_slotsHelper);
        slotsChannelFinalizer = _slotsChannelFinalizer;
        require(slotsHelper.isSlotsHelper());
        name = 'Slots Channel Manager';
        isHouseOffering = true;
    }

    /* Modifiers */

    modifier onlyHouse() {
        require(msg.sender == houseAddress);
        _;
    }

    modifier onlyAuthorized() {
        require(houseAuthorizedController.authorized(msg.sender));
        _;
    }

    // Allows functions to be executed only if the house is in an emergency paused state
    modifier isHouseEmergency() {
        require(house.emergencyPaused());
        _;
    }

    // Allows functions to be execute only if the house is not in an emergency paused state
    modifier isNotHouseEmergency() {
        require(!house.emergencyPaused());
        _;
    }

    // Allows functions to execute only if users have "amount" dbets in their token contract balance.
    modifier isDbetsAvailable(uint amount) {
        require(decentBetToken.balanceOf(msg.sender) >= amount);
        _;
    }

    // Allow functions to execute only if the current session is active
    modifier isSessionActive() {
        require(houseSessionsController.isSessionActive(currentSession));
        _;
    }

    // Allows functions to execute only if the session is prior or equal to current house session
    // and if session is not 0.
    modifier isValidPriorSession(uint session) {
        require(session <= currentSession && session != 0);
        _;
    }

    // Allows functions to execute only if users have "amount" tokens in their depositedTokens balance.
    modifier isTokensAvailable(uint amount, uint session) {
        require(depositedTokens[msg.sender][session] >= amount);
        _;
    }

    // Allows only the player to proceed
    modifier isPlayer(bytes32 id) {
        require(msg.sender == players[id][false]);
        _;
    }

    // Allows only if the user is ready
    modifier isUserReady(bytes32 id) {
        require(channels[id].ready);
        _;
    }

    // Allows only if the user is not ready
    modifier isUserNotReady(bytes32 id) {
        require(!channels[id].ready);
        _;
    }

    // Allows only if channel has not been activated
    modifier isNotActivated(bytes32 id) {
        require(!channels[id].activated);
        _;
    }

    // Allows functions to execute only if the sender has been KYC verified.
    modifier isSenderKycVerified() {
        require(kycManager.isVerified(address(this), msg.sender));
        _;
    }

    /* Functions */
    function createChannel(uint initialDeposit)
    public
    isSenderKycVerified
    isNotHouseEmergency
    isSessionActive {
        // Deposit in DBETs. Use ether since 1 DBET = 18 Decimals i.e same as ether decimals.
        require(initialDeposit >= MIN_DEPOSIT && initialDeposit <= MAX_DEPOSIT);
        require(balanceOf(msg.sender, currentSession) >= initialDeposit);
        bytes32 channelId = keccak256(channelCount, msg.sender, getTime());
        channels[channelId] = Channel({
            ready: false,
            activated: false,
            finalized: false,
            endTime: 0,
            finalUserHash: '',
            initialUserNumber: '',
            initialDeposit: initialDeposit,
            finalReelHash: '',
            finalSeedHash: '',
            finalNonce: 0,
            finalTurn: false,
            session: currentSession,
            exists: true
        });
        players[channelId][false] = msg.sender;
        emit LogNewChannel(channelId, msg.sender, initialDeposit, getTime());
        channelCount++;
    }

    // Allows the house to add funds to the provider for this session or the next.
    function houseDeposit(uint amount, uint session)
    public
    isNotHouseEmergency
    onlyHouse
    returns (bool) {
        // House deposits are allowed only for this session or the next.
        require(session == currentSession || session == currentSession + 1);

        // Record the total number of tokens deposited into the house.
        depositedTokens[address(this)][session] = safeAdd(depositedTokens[address(this)][session], amount);

        // Transfer tokens from house to betting provider.
        if(!decentBetToken.transferFrom(msg.sender, address(this), amount)) revert();

        emit LogDeposit(address(this), amount, session, depositedTokens[address(this)][session]);
        return true;
    }

    // Allows house to withdraw session tokens for the previous session.
    function withdrawPreviousSessionTokens()
    public
    onlyHouse
    returns (bool) {
        uint previousSession = safeSub(currentSession, 1);
        require(depositedTokens[address(this)][previousSession] > 0);
        uint previousSessionTokens = depositedTokens[address(this)][previousSession];
        depositedTokens[address(this)][previousSession] = 0;
        if(!decentBetToken.transfer(msg.sender, previousSessionTokens)) revert();
        return true;
    }

    // Allows house to withdraw current session tokens if the house is in an emergency pause state.
    function emergencyWithdrawCurrentSessionTokens()
    public
    onlyHouse
    isHouseEmergency
    returns (bool) {
        require(depositedTokens[address(this)][currentSession] > 0);
        uint currentSessionTokens = depositedTokens[address(this)][currentSession];
        depositedTokens[address(this)][currentSession] = 0;
        if(!decentBetToken.transfer(msg.sender, currentSessionTokens)) revert();
        return true;
    }

    // Deposits DBET to contract for the current session.
    // User needs to approve contract address for amount prior to calling this function.
    function deposit(uint amount)
    public
    isDbetsAvailable(amount)
    returns (bool) {
        depositedTokens[msg.sender][currentSession] =
        safeAdd(depositedTokens[msg.sender][currentSession], amount);
        if(!decentBetToken.transferFrom(msg.sender, address(this), amount)) revert();
        emit LogDeposit(msg.sender, amount, currentSession, depositedTokens[msg.sender][currentSession]);
        return true;
    }

    // Withdraw DBETS from contract to sender address.
    function withdraw(uint amount, uint session)
    public
    isValidPriorSession(session)
    isTokensAvailable(amount, session)
    returns (bool) {
        depositedTokens[msg.sender][session] = safeSub(depositedTokens[msg.sender][session], amount);
        if(!decentBetToken.transfer(msg.sender, amount)) revert();
        emit LogWithdraw(msg.sender, amount, session, depositedTokens[msg.sender][session]);
        return true;
    }

    function setSession(uint session)
    public
    onlyHouse returns (bool) {
        currentSession = session;
        return true;
    }

    // User deposits DBETs into contract and saves the AES-256 encrypted string of the initial random numbers
    // used to generate all hashes
    function depositChannel(bytes32 id, string _initialUserNumber, string _finalUserHash) // 584k gas
    isSenderKycVerified
    isNotHouseEmergency
    isPlayer(id)
    isUserNotReady(id)
    public
    returns (bool) {
        require(strLen(_finalUserHash) == 64);
        require(strLen(_initialUserNumber) == 64);
        require(balanceOf(msg.sender, channels[id].session) >= channels[id].initialDeposit);
        channels[id].initialUserNumber = _initialUserNumber;
        channels[id].finalUserHash = _finalUserHash;
        channels[id].ready = true;
        transferTokensToChannel(id, false);
        emit LogChannelDeposit(id, players[id][false], _finalUserHash);
        return true;
    }

    // Allows users to remove their deposit from a channel IF the channel hasn't
    // been activated yet and the user is ready.
    function withdrawChannelDeposit(bytes32 id)
    isSenderKycVerified
    isPlayer(id)
    isUserReady(id)
    isNotActivated(id)
    public {
        uint channelDeposit = channelDeposits[id][false];
        channelDeposits[id][false] = 0;
        depositedTokens[msg.sender][channels[id].session] =
            safeAdd(depositedTokens[msg.sender][channels[id].session], channelDeposit);
        channels[id].ready = false;
    }

    // House sends the final reel and seed hashes to activate the channel along with the initial house seed hash
    // to verify the blended seed after a channel is closed
    function activateChannel(
        bytes32 id,
        string _finalSeedHash,
        string _finalReelHash
    ) // 373k gas
    public
    onlyAuthorized
    isNotActivated(id)
    isUserReady(id)
    returns (bool) {
        // The house will be unable to activate a channel IF it doesn't have enough tokens
        // in it's balance - which could happen organically or at the end of a session.
        require(balanceOf(address(this), channels[id].session) >= channels[id].initialDeposit);
        channels[id].finalReelHash = _finalReelHash;
        channels[id].finalSeedHash = _finalSeedHash;
        channels[id].activated = true;
        players[id][true] = msg.sender;
        transferTokensToChannel(id, true);
        emit LogChannelActivate(id, players[id][true], _finalSeedHash, _finalReelHash);
        return true;
    }

    // Transfers tokens to a channel.
    function transferTokensToChannel(bytes32 id, bool isHouse)
    private {
        // Transfer from house address instead of authorized addresses sending txs on behalf of the house
        address _address = isHouse ? address(this) : players[id][false];
        channelDeposits[id][isHouse] =
        safeAdd(channelDeposits[id][isHouse], channels[id].initialDeposit);
        depositedTokens[_address][channels[id].session] =
        safeSub(depositedTokens[_address][channels[id].session], channels[id].initialDeposit);
    }

    // Sets the final spin for the channel
    function setFinal(
        bytes32 id,
        uint userBalance,
        uint houseBalance,
        uint nonce,
        bool turn
    )
    external {
        require(msg.sender == address(slotsChannelFinalizer));

        finalBalances[id][false] = userBalance;
        finalBalances[id][true] = houseBalance;
        channels[id].finalNonce = nonce;
        channels[id].finalTurn = turn;
        channels[id].endTime = getTime() + 1 minutes;
        // Set at 1 minute only for Testnet
        if (!channels[id].finalized) channels[id].finalized = true;
        emit LogChannelFinalized(id, turn);
    }

    // Allows player/house to claim DBETs after the channel has closed
    function claim(bytes32 id)
    public {
        require(isParticipant(id, msg.sender));

        bool isHouse = (players[id][true] == msg.sender);

        if (isChannelClosed(id)) {
            uint256 amount = finalBalances[id][isHouse];
            if (amount > 0) {
                finalBalances[id][isHouse] = 0;
                channelDeposits[id][isHouse] = 0;

                // Deposit to the house address instead of authorized addresses sending txs on behalf of the house
                address _address = isHouse ? address(this) : msg.sender;

                depositedTokens[_address][channels[id].session] =
                safeAdd(depositedTokens[_address][channels[id].session], amount);

                emit LogClaimChannelTokens(id, isHouse, getTime());
            }
        } else
            revert();
    }

    // Query balance of deposited tokens for a user.
    function balanceOf(address _address, uint session)
    public
    view
    returns (uint) {
        return depositedTokens[_address][session];
    }

    // Query balance of channel tokens for either party
    function channelBalanceOf(bytes32 id, bool isHouse)
    public
    view
    returns (uint) {
        return finalBalances[id][isHouse];
    }

    // Checks the signature of a spin sent and verifies it's validity
    function checkSig(
        bytes32 id,
        bytes32 hash,
        bytes sig,
        bool turn
    )
    public
    view
    returns (bool) {
        //        bytes32 hash = sha3(reelHash, reel, reelSeedHash, prevReelSeedHash, userHash, prevUserHash,
        //        nonce, turn, userBalance, houseBalance, betSize);
        //        address player = players[turn];
        return ECVerify.ecverify(hash, sig, players[id][turn]);
    }

    // Returns the address for a signed spin
    function getSigAddress(
        bytes32 _msg,
        uint8 v,
        bytes32 r,
        bytes32 s
    )
    public
    pure
    returns (address) {
        return ecrecover(keccak256(_msg), v, r, s);
    }

    // Allows only the house and player to proceed
    function isParticipant(bytes32 id, address _address)
    public
    view
    returns (bool) {
        return (
            houseAuthorizedController.authorized(_address) || _address == players[id][false]
        );
    }

    function isChannelActivated(bytes32 id)
    public
    view
    returns (bool) {
        return channels[id].activated;
    }

    function isValidZeroNonceSpin(bytes32 id, string reelHash, string userHash, string reelSeedHash, uint userBalance)
    public
    view
    returns (bool) {
        return (
            strCompare(reelHash, channels[id].finalReelHash) &&
            strCompare(userHash, channels[id].finalUserHash) &&
            strCompare(reelSeedHash, channels[id].finalSeedHash) &&
            userBalance == channels[id].initialDeposit
        );
    }

    // Helper function to return channel information for the frontend
    function getChannelInfo(bytes32 id)
    public
    view
    returns (address, bool, bool, bool, uint, uint, uint) {
        return (
            players[id][false],
            channels[id].ready,
            channels[id].activated,
            channels[id].finalized,
            channels[id].initialDeposit,
            channels[id].finalNonce,
            channels[id].endTime
        );
    }

    // Helper function to return hashes used for the frontend/backend
    function getChannelHashes(bytes32 id)
    public
    view
    returns (string, string, string, string) {
        return (
            channels[id].finalUserHash,
            channels[id].initialUserNumber,
            channels[id].finalReelHash,
            channels[id].finalSeedHash
        );
    }

    // Helper function to return whether a channel has been finalized and it's final nonce
    function getChannelFinalized(bytes32 id)
    public
    view
    returns (bool, uint) {
        return (channels[id].finalized, channels[id].finalNonce);
    }

    function getPlayer(bytes32 id, bool isHouse)
    public
    view
    returns (address){
        return players[id][isHouse];
    }

    // Utility function to check whether the channel has closed
    function isChannelClosed(bytes32 id)
    public
    view
    returns (bool) {
        return channels[id].finalized && getTime() > channels[id].endTime;
    }

    function getTime()
    public
    view
    returns (uint) {
        return now;
    }

}
