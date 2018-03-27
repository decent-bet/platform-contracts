pragma solidity ^0.4.0;


import './AbstractHouse.sol';
import './HouseOffering.sol';
import '../Libraries/SafeMath.sol';
import '../Token/ERC20.sol';
import '../Libraries/oraclizeAPI.sol';

contract HouseLottery is SafeMath, usingOraclize {

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
        if (msg.sender != owner) throw;
        _;
    }

    modifier onlyHouse() {
        if (msg.sender != house) throw;
        _;
    }

    // Events
    event LogHouseDeposit(uint session, uint amount);

    event LogWinner(uint session, uint number, uint randomInRange, uint ticketCount, address winner);

    event callback(string message);

    event oraclizePricingError(uint price);

    function HouseLottery() {
        owner = msg.sender;
        // TODO: Replace with oraclize address.
        OAR = OraclizeAddrResolverI(0x1ab9be4a13b0039eac53ca515584849d001af069);
    }

    // Abstract lottery function
    function isHouseLottery() returns (bool) {
        return true;
    }

    function setHouse(address _house) onlyOwner {
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
        if (session == 0 || session <= currentSession) throw;

        // This is where currentSession is initialized in the contract.
        // It will only be set when the house would like to pick a winner for a session
        currentSession = session;
        uint ticketCount = lotteries[session].ticketCount;

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

    function __callback(bytes32 myid, string _result) {
        callback("callback received");
        if (msg.sender != oraclize_cbAddress()) revert();
        uint number = parseOraclizeResult(_result);
        uint randomNumber = randomInRange(number, lotteries[currentSession].ticketCount);
        lotteries[currentSession].winningTicket = randomNumber;
        lotteries[currentSession].finalized = true;
        LogWinner(currentSession,
                  number,
                  randomNumber,
                  lotteries[currentSession].ticketCount,
                  lotteryTicketHolders[currentSession][randomNumber]);
    }

    function parseOraclizeResult(string _result) returns (uint) {
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

    function updateLotteryPayout(uint session, uint payout) onlyHouse external returns (bool) {
        lotteries[session].payout = payout;
        lotteries[session].claimed = true;
        return true;
    }

    // Number = 7 digit random number from random.org
    // Participants = Number of participants in this session
    function randomInRange(uint number, uint tickets) returns (uint) {
        uint range = 8999999;
        uint numberInRange = safeDiv(safeMul(safeSub(number, 1000000), safeAdd(tickets, 1)), range);
        if (numberInRange > tickets)
            numberInRange = tickets;
        return numberInRange;
    }

    function isLotteryFinalized(uint session) constant returns (bool) {
        return lotteries[session].finalized;
    }

    function isLotteryClaimed(uint session) constant returns (bool) {
        return lotteries[session].claimed;
    }

    function getUserTicketCount(uint session, address _address) constant returns (uint) {
        return lotteryUserTickets[session][_address].length;
    }

    function getLotteryWinner(uint session) constant returns (address) {
        if (!lotteries[session].finalized) revert();
        return lotteryTicketHolders[session][lotteries[session].winningTicket];
    }

    // Do not accept payments in ETH
    function() {
        throw;
    }

}
