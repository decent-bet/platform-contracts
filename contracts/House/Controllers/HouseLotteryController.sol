pragma solidity ^0.4.19;


import '../HouseOffering.sol';
import '../../Libraries/SafeMath.sol';
import '../../Token/ERC20.sol';
import '../../Libraries/oraclizeAPI.sol';

contract HouseLotteryController is SafeMath, usingOraclize {

    // Structs
    struct Lottery {
        // Number of tickets allotted.
        uint ticketCount;
        // Winning ticket.
        uint winningTicket;
        // Payout for winning ticket in this session.
        uint payout;
        // Toggled when winnings are claimed.
        bool claimed;
        // Toggled when a winning ticket has been set.
        bool finalized;
    }

    // Variables
    address public owner;
    address public house;
    uint public currentSession;
    bool public isHouseLotteryController = true;

    // Mappings
    // Winners for each session
    mapping (uint => Lottery) public lotteries;

    // Ticket holders for a session's lottery.
    mapping (uint => mapping(uint => address)) public lotteryTicketHolders;

    // Number of tickets in session lottery for a user.
    mapping (uint => mapping(address => uint[])) public lotteryUserTickets;

    // IDs generated for RNG during each session.
    mapping (uint => bytes32) public rngIds;

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    modifier onlyHouse() {
        require(msg.sender == house);
        _;
    }

    // Events
    event LogHouseDeposit(uint session, uint amount);

    event LogWinner(uint session, uint number, uint randomInRange, uint ticketCount, address winner);

    event callback(string message);

    event oraclizePricingError(uint price);

    function HouseLotteryController() public {
        owner = msg.sender;
        // TODO: Replace with oraclize address.
        OAR = OraclizeAddrResolverI(0x6f485C8BF6fc43eA212E93BBF8ce046C7f1cb475);
    }

    function setHouse(address _house) onlyOwner public {
        house = _house;
    }

    function allotLotteryTickets (uint session, address _address, uint tokenAmount)
    onlyHouse external returns (bool) {
        uint numberOfTickets = safeDiv(tokenAmount, 1000 ether);
        uint userTicketCount = lotteryUserTickets[session][_address].length;
        uint ticketCount = lotteries[session].ticketCount;

        // Allot lottery tickets for credit holders.
        if (userTicketCount < 5 && numberOfTickets > 0) {
            for (uint i = 0; i < numberOfTickets; i++) {
                lotteryUserTickets[session][_address].push(ticketCount);
                lotteryTicketHolders[session][ticketCount++] = _address;
                if (lotteryUserTickets[session][_address].length >= 5)
                    break;
            }
            lotteries[session].ticketCount = ticketCount;
        }

        return true;
    }

    function pickWinner(uint session) payable
    onlyHouse external returns (bool) {
        // Throw if session passed from the house is less than currentSession set in the lottery contract
        if (session == 0 || session <= currentSession) revert();

        // Should only work if the winning number has not been finalized.
        require(!isLotteryFinalized(session));

        // This is where currentSession is initialized in the contract.
        // It will only be set when the house would like to pick a winner for a session
        currentSession = session;

        // Sufficient ETH needs to be sent with this transaction.
        if (oraclize_getPrice("WolframAlpha") > this.balance) {
            callback("Oraclize query was NOT sent, please add some ETH to cover for the query fee");
            oraclizePricingError(oraclize_getPrice("WolframAlpha"));
        }
        else {
            callback("Oraclize query was sent, standing by for the answer..");
            bytes32 rngId = oraclize_query(
            "WolframAlpha",
            "random number between 1000000 and 9999999");
            rngIds[currentSession] = rngId;
        }

        return true;
    }

    function __callback(bytes32 id, string _result) public {
        callback("callback received");
        require(msg.sender == oraclize_cbAddress());
        uint number = parseOraclizeResult(_result);
        uint previousSession = safeSub(currentSession, 1);
        uint randomNumber = randomInRange(number, lotteries[previousSession].ticketCount);
        lotteries[previousSession].winningTicket = randomNumber;
        lotteries[previousSession].finalized = true;
        LogWinner(previousSession,
                  number,
                  randomNumber,
                  lotteries[previousSession].ticketCount,
                  lotteryTicketHolders[previousSession][randomNumber]);
    }

    function parseOraclizeResult(string _result) public pure returns (uint) {
        uint number;
        string memory temp = '';
        bytes memory result = bytes(_result);
        // Example _result: [1245343]
        for (uint i = 0; i <= result.length - 1; i++) {
            string memory char = new string(1);
            bytes memory _char = bytes(char);
            _char[0] = result[i];
            temp = strConcat(temp, string(_char));
            if (i == result.length - 1) {
                number = parseInt(string(temp));
            }
        }
        return number;
    }

    function updateLotteryPayout(uint session, address sender, uint payout) onlyHouse external returns (bool) {
        // Should only work after the winning number has been finalized.
        require(isLotteryFinalized(session));
        // Should not work if the winnings have already been claimed.
        require(!isLotteryClaimed(session));
        // Only holder of the winning ticket can withdraw.
        require(getLotteryWinner(session) == sender);

        lotteries[session].payout = payout;
        lotteries[session].claimed = true;
        return true;
    }

    // Number = 7 digit random number from random.org
    // Participants = Number of participants in this session
    function randomInRange(uint number, uint tickets) public pure returns (uint) {
        uint range = 8999999;
        uint numberInRange = safeDiv(safeMul(safeSub(number, 1000000), tickets), range);
        // ((2995848 - 1000000) * (5)/8999999)
        if (numberInRange > tickets)
            numberInRange = tickets;
        return numberInRange;
    }

    function isLotteryFinalized(uint session) public constant returns (bool) {
        return lotteries[session].finalized;
    }

    function isLotteryClaimed(uint session) public constant returns (bool) {
        return lotteries[session].claimed;
    }

    function getUserTicketCount(uint session, address _address) public constant returns (uint) {
        return lotteryUserTickets[session][_address].length;
    }

    function getLotteryWinner(uint session) public constant returns (address) {
        require(lotteries[session].finalized);
        return lotteryTicketHolders[session][lotteries[session].winningTicket];
    }

    // Do not accept payments in ETH
    function() public {
        revert();
    }

}
