pragma solidity ^0.4.8;

import '../Libraries/SafeMath.sol';
import '../Token/AbstractDecentBetToken.sol';
import './AbstractHouseLottery.sol';
import '../Betting/AbstractSportsOracle.sol';
import './HouseOffering.sol';
import './HouseLottery.sol';
import '../Libraries/TimeProvider.sol';

// Decent.bet House Contract.
// All credits and payouts are in DBETs and are 18 decimal places in length.
contract House is SafeMath, TimeProvider {

    // Structs
    struct UserCredits {
        uint amount;
        uint liquidated;
        uint rolledOverFromPreviousSession;
        uint claimedFromPreviousSession;
        uint rolledOverToNextSession;
        bool exists;
    }

    struct HouseFunds {
        // Total funds available to house for this session.
        uint totalFunds;
        // Total credits purchased by users, does not change on liquidation.
        uint totalPurchasedUserCredits;
        // Current credits available to house, will reduce when users liquidate.
        uint totalUserCredits;
        mapping (address => UserCredits) userCredits;
        mapping (address => uint) payouts;
        // Credit holders in the house for this session.
        address[] users;
        // Total DBETs payed out by the house for this session.
        uint totalHousePayouts;
        // Total DBETs withdrawn by the house for this session.
        uint totalWithdrawn;
        // Total DBETs added to profits by the house for unregistered offerings from this session.
        uint totalUnregisteredOfferingProfits;
        // Total profit generate by the house for this session.
        uint profit;
    }

    struct Session {
        uint startTime;
        uint endTime;
        bool active;
        // Offerings available for this session.
        address[] offerings;
        // Offerings that have been withdrawn from in this session.
        // All offerings must be withdrawn to switch to the next session.
        mapping (address => bool) withdrawnOfferings;
        uint withdrawCount;
        // %age allocation of total tokens for deposit at start of session.
        mapping (address => TokenAllocations) offeringTokenAllocations;
        // Total % of tokens allocated, must be equal before switching to next session.
        uint totalTokensAllocated;
        // Increments by 1 after each deposit to an offering allocation.
        uint depositedAllocations;
    }

    struct TokenAllocations {
        // Amount allocated to offering.
        uint allocation;
        bool deposited;
    }

    struct Offering {
        HouseOffering houseOffering;
        bool exists;
    }

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
    address public founder;

    address[] public offeringAddresses;

    address[] public authorizedAddresses;

    uint public constant PROFIT_SHARE_PERCENT = 95;

    // Starting session will be at 0.
    // This would be the credit buying period for the 1st session of the house and lasts only for 1 week.
    uint public currentSession = 0;

    // Time session 0 begins.
    uint public sessionZeroStartTime = 0;

    uint public MIN_CREDIT_PURCHASE = 1000 ether;

    // External Contracts
    AbstractDecentBetToken public decentBetToken;

    AbstractHouseLottery public houseLottery;

    // Mappings
    // House funds per session
    mapping (uint => HouseFunds) public houseFunds;

    // Session lottery info.
    mapping (uint => Lottery) public lotteries;

    // Ticket holders for a session's lottery.
    mapping (uint => mapping(uint => address)) public lotteryTicketHolders;

    // Number of tickets in session lottery for a user.
    mapping (uint => mapping(address => uint[])) public lotteryUserTickets;

    // House offerings available for house.
    mapping (address => Offering) offerings;

    // Authorized addresses.
    mapping (address => bool) public authorized;

    // Session statistics.
    mapping (uint => Session) public sessions;

    // Constructor
    function House(address decentBetTokenAddress) {
        if (decentBetTokenAddress == 0) revert();
        founder = msg.sender;
        authorizedAddresses.push(founder);
        authorized[founder] = true;
        decentBetToken = AbstractDecentBetToken(decentBetTokenAddress);

        // If on local testRPC/testnet and need mock times
        isMock = true;
        setTimeController(msg.sender);
    }

    // Modifiers //
    modifier onlyFounder() {
        if (msg.sender != founder) revert();
        _;
    }

    modifier onlyAuthorized() {
        if (msg.sender == 0x0) revert();
        if (authorized[msg.sender] == false) revert();
        _;
    }

    // Allows functions to execute only if it's currently a credit-buying period i.e
    // 1 week before the end of the current session.
    modifier isCreditBuyingPeriod() {
        if (currentSession == 0 && sessionZeroStartTime == 0) revert();
        if (currentSession != 0 &&
        ((getTime() < (sessions[currentSession].endTime - 2 weeks)) ||
        (getTime() > (sessions[currentSession].endTime - 1 weeks)))) revert();
        _;
    }

    // If this is the last week of a session - signifying the period when token deposits can be made to house offerings.
    modifier isLastWeekForSession() {
        if (currentSession == 0 && sessionZeroStartTime == 0) revert();
        if (getTime() < (sessions[currentSession].endTime - 1 weeks) ||
        getTime() > (sessions[currentSession].endTime)) revert();
        _;
    }

    // Allows functions to execute only if users have "amount" tokens in their balance.
    modifier areTokensAvailable(uint amount) {
        if (decentBetToken.balanceOf(msg.sender) < amount) revert();
        _;
    }


    // Allows functions to execute only if users have "amount" credits available for "session".
    modifier areCreditsAvailable(uint session, uint amount) {
        if (houseFunds[session].userCredits[msg.sender].amount < amount) revert();
        _;
    }

    // Allows functions to execute only if rolled over credits from the previous session are available.
    modifier areRolledOverCreditsAvailable() {
        if (houseFunds[currentSession].userCredits[msg.sender].rolledOverFromPreviousSession == 0) revert();
        _;
    }

    // Allows functions to execute if they happen during an "active" period for a session i.e,
    // Not during a credit buying/token allocation period
    modifier isSessionActivePeriod() {
        if(currentSession == 0) revert();
        if(getTime() < sessions[currentSession].startTime ||
        getTime() > (sessions[currentSession].endTime - 2 weeks)) revert();
        _;
    }

    // Allows functions to execute only if the profit distribution period is going on i.e
    // after the end of the previous session.
    modifier isProfitDistributionPeriod(uint session) {
        if (session == 0) revert();
        if (getTime() < sessions[session].endTime + 4 days) revert();
        _;
    }

    // Allows functions to execute only if it is the end of the current session.
    modifier isEndOfSession() {
        if (!(currentSession == 0 && sessions[currentSession].endTime == 0)
        && getTime() < sessions[currentSession].endTime) revert();
        _;
    }

    // Allows functions to execute only if the house offering exists.
    modifier isValidHouseOffering(address offering) {
        if(!offerings[offering].exists) revert();
        _;
    }

    // Allows functions to execute only if lottery has not been finalized.
    modifier isLotteryNotFinalized(uint session) {
        if(lotteries[session].finalized) revert();
        _;
    }

    // Events
    event LogPurchasedCredits(address creditHolder, uint session, uint amount, uint balance);

    event LogLiquidateCredits(address creditHolder, uint session, uint amount, uint payout, uint balance);

    event LogRolledOverCredits(address creditHolder, uint session, uint amount);

    event LogClaimRolledOverCredits(address creditHolder, uint session, uint rolledOver, uint adjusted,
        uint balance);

    event LogNewSession(uint session, uint startTimestamp, uint startBlockNumber, uint endTimestamp, uint endBlockNumber);

    event LogNewHouseOffering(address offeringAddress, bytes32 name);

    event LogPickLotteryWinner(uint session, uint participantCount);

    event LogWinningTicket(uint session, uint ticketNumber, address _address);

    event LogOfferingAllocation(uint session, address offering, uint percentage);

    event LogOfferingDeposit(uint session, address offering, uint percentage, uint amount);

    // Adds an address to the list of authorized addresses.
    function addToAuthorizedAddresses(address _address)
    onlyFounder {
        authorizedAddresses.push(_address);
        authorized[_address] = true;
    }

    // Removes an address from the list of authorized addresses.
    function removeFromAuthorizedAddresses(address _address)
    onlyFounder {
        if(_address == msg.sender) revert();
        if (authorized[_address] == false) revert();
        for (uint i = 0; i < authorizedAddresses.length; i++) {
            if (authorizedAddresses[i] == _address) {
                delete authorizedAddresses[i];
                authorized[_address] = false;
                break;
            }
        }
    }

    // Adds a new offering to the house.
    function addHouseOffering(address houseOfferingAddress)
    onlyFounder {
        // Empty address, invalid input
        if(houseOfferingAddress == 0) revert();
        // Not a house offering
        if(!HouseOffering(houseOfferingAddress).isHouseOffering())
            revert();
        // Offering was already added
        if(offerings[houseOfferingAddress].exists) revert();

        offeringAddresses.push(houseOfferingAddress);
        offerings[houseOfferingAddress] = Offering({
            houseOffering: HouseOffering(houseOfferingAddress),
            exists: true
            });
        addOfferingToNextSession(houseOfferingAddress);
        LogNewHouseOffering(houseOfferingAddress, offerings[houseOfferingAddress].houseOffering.name());
    }

    // Adds a house offering to the next session
    function addOfferingToNextSession(address houseOfferingAddress)
    isValidHouseOffering(houseOfferingAddress)
    onlyFounder {
        uint nextSession = currentSession + 1;
        sessions[nextSession].offerings.push(houseOfferingAddress);
    }

    // Remove an offering from the next session
    function removeOfferingFromNextSession(address houseOfferingAddress)
    isValidHouseOffering(houseOfferingAddress)
    onlyFounder {
        // TODO: Look into support for current session - freeze contract, allow token withdrawals etc.
        uint nextSession = currentSession + 1;
        for(uint i = 0; i < sessions[nextSession].offerings.length; i++) {
            if(sessions[nextSession].offerings[i] == houseOfferingAddress)
                delete sessions[nextSession].offerings[i];
        }
    }

    // TODO: Add function to remove offering from offering mapping.

    // Sets the lottery address.
    function setHouseLotteryAddress(address houseLotteryAddress)
    onlyFounder {
        if(houseLotteryAddress == 0x0) revert();
        if(!AbstractHouseLottery(houseLotteryAddress).isHouseLottery()) revert();
        houseLottery = AbstractHouseLottery(houseLotteryAddress);
    }

    // Transfers DBETs from users to house contract address and generates credits in return.
    // House contract must be approved to transfer amount from msg.sender to house.
    function purchaseCredits(uint amount)
    isCreditBuyingPeriod
    areTokensAvailable(amount)
    {

        // The minimum credit purchase needs to be 1000 DBETs
        if(amount < MIN_CREDIT_PURCHASE) revert();
        if(decentBetToken.allowance(msg.sender, address(this)) < amount) revert();

        // Issue credits to user equivalent to amount transferred.
        uint nextSession = safeAdd(currentSession, 1);

        // Add to house and user funds.
        houseFunds[nextSession].totalFunds =
        safeAdd(houseFunds[nextSession].totalFunds, amount);
        houseFunds[nextSession].totalPurchasedUserCredits =
        safeAdd(houseFunds[nextSession].totalPurchasedUserCredits, amount);
        houseFunds[nextSession].totalUserCredits =
        safeAdd(houseFunds[nextSession].totalUserCredits, amount);
        houseFunds[nextSession].userCredits[msg.sender].amount =
        safeAdd(houseFunds[nextSession].userCredits[msg.sender].amount, amount);

        // Add user to house users array for UI iteration purposes.
        if (houseFunds[nextSession].userCredits[msg.sender].exists == false) {
            houseFunds[nextSession].users.push(msg.sender);
            houseFunds[nextSession].userCredits[msg.sender].exists = true;
        }

        allotLotteryTickets(nextSession, amount);

        // Transfer tokens to house contract address.
        if (!decentBetToken.transferFrom(msg.sender, address(this), amount)) revert();

        LogPurchasedCredits(msg.sender, nextSession, amount, houseFunds[nextSession].userCredits[msg.sender].amount);
    }

    function allotLotteryTickets (uint session, uint tokenAmount) internal {
        uint numberOfTickets = safeDiv(tokenAmount, 1000 ether);
        uint userTicketCount = lotteryUserTickets[session][msg.sender].length;
        uint ticketCount = lotteries[session].ticketCount;

        // Allot lottery tickets for credit holders.
        if (userTicketCount < 5 && numberOfTickets > 0) {
            for (uint i = userTicketCount; i < 5; i++) {
                lotteryUserTickets[session][msg.sender].push(ticketCount);
                lotteryTicketHolders[session][ticketCount++] = msg.sender;
                if (lotteryUserTickets[session][msg.sender].length >= 5)
                    break;
            }
            lotteries[session].ticketCount = ticketCount;
        }
    }

    // Allows users to return credits and receive tokens along with profit in return.
    function liquidateCredits(uint session)
    isProfitDistributionPeriod(session) {
        if(houseFunds[session].userCredits[msg.sender].amount == 0) revert();

        // Payout variables
        uint payoutPerCredit = getPayoutPerCredit(session);
        uint amount = houseFunds[session].userCredits[msg.sender].amount;
        // (Payout per credit * amount of credits)
        uint payout = safeDiv(safeMul(payoutPerCredit, amount), 1 ether);

        // Payout users for current session and liquidate credits.
        houseFunds[session].payouts[msg.sender] =
            safeAdd(houseFunds[session].payouts[msg.sender], payout);
        houseFunds[session].totalUserCredits =
            safeSub(houseFunds[session].totalUserCredits, amount);
        houseFunds[session].totalFunds =
            safeSub(houseFunds[session].totalFunds, amount);
        houseFunds[session].userCredits[msg.sender].amount =
            safeSub(houseFunds[session].userCredits[msg.sender].amount, amount);
        houseFunds[session].userCredits[msg.sender].liquidated =
            safeAdd(houseFunds[session].userCredits[msg.sender].liquidated, amount);
        houseFunds[session].totalHousePayouts =
            safeAdd(houseFunds[session].totalHousePayouts, payout);

        // Transfers from house to user.
        if (!decentBetToken.transfer(msg.sender, payout)) revert();

        LogLiquidateCredits(msg.sender, session, amount, payout, houseFunds[session].userCredits[msg.sender].amount);
    }

    // Returns the payout per credit based on the house winnings for a session.

    /* NOTE:
        Since solidity cannot handle floating point types, to avoid instances where the payout per credit may lose value
        due to loss of precision with using 1 as the base amount - The resulting payoutPerCredit uses 1 ether as a base
        amount which means that the resulting payoutPerCredit would have to be multiplied by the actual amount
        of credits and then divided by 1 ether to get the final payout amount.
    */

    function getPayoutPerCredit(uint session) constant returns (uint) {

        uint totalWithdrawn = houseFunds[session].totalWithdrawn;
        uint totalUnregisteredOfferingProfits = houseFunds[session].totalUnregisteredOfferingProfits;

        uint totalPayout = safeAdd(totalWithdrawn, totalUnregisteredOfferingProfits);
        uint totalPurchasedUserCredits = houseFunds[session].totalPurchasedUserCredits;

        // ((User Credits / Total User Credits) * Total Withdrawn) * PROFIT_SHARE_PERCENT/100;
        return safeDiv(safeMul(safeMul(1 ether, totalPayout), PROFIT_SHARE_PERCENT),
            safeMul(totalPurchasedUserCredits, 100));
    }

    // Allows users holding credits in the current session to roll over their credits to the
    // next session.
    function rollOverCredits(uint amount)
    areCreditsAvailable(currentSession, amount)
    isCreditBuyingPeriod {

        if (currentSession == 0) revert();

        // Payout and current session variables.
        uint available = houseFunds[currentSession].userCredits[msg.sender].amount;
        uint rolledOverToNextSession = houseFunds[currentSession].userCredits[msg.sender]
                                        .rolledOverToNextSession;
        uint rolledOverFromPreviousSession = houseFunds[currentSession].userCredits[msg.sender]
                                        .rolledOverFromPreviousSession;

        // Next session variables.
        uint nextSession = safeAdd(currentSession, 1);

        // Rollover credits from current session to next.
        houseFunds[currentSession].userCredits[msg.sender].amount = safeSub(available, amount);
        houseFunds[currentSession].userCredits[msg.sender].rolledOverToNextSession =
        safeAdd(rolledOverToNextSession, amount);

        // Add to credits for next session.
        houseFunds[nextSession].userCredits[msg.sender].rolledOverFromPreviousSession =
        safeAdd(rolledOverFromPreviousSession, amount);

        LogRolledOverCredits(msg.sender, currentSession, amount);
    }

    function claimRolledOverCredits()
    isSessionActivePeriod
    areRolledOverCreditsAvailable {
        uint previousSession = currentSession - 1;
        uint rolledOverFromPreviousSession = houseFunds[currentSession].userCredits[msg.sender]
        .rolledOverFromPreviousSession;

        // Multiply by credits : tokens ratio from previous session to get adjusted credits for new session
        uint prevTotalPurchasedUserCredits = houseFunds[previousSession].totalPurchasedUserCredits;
        uint prevTotalWithdrawn = houseFunds[previousSession].totalWithdrawn;

        uint adjustedCredits = safeDiv(safeMul(rolledOverFromPreviousSession, prevTotalWithdrawn),
            prevTotalPurchasedUserCredits);
        uint userSessionCredits = houseFunds[currentSession].userCredits[msg.sender].amount;

        houseFunds[currentSession].userCredits[msg.sender].claimedFromPreviousSession = adjustedCredits;
        houseFunds[currentSession].userCredits[msg.sender].rolledOverFromPreviousSession = 0;

        houseFunds[currentSession].userCredits[msg.sender].amount = safeAdd(userSessionCredits, adjustedCredits);
        if (houseFunds[currentSession].userCredits[msg.sender].exists == false) {
            houseFunds[currentSession].users.push(msg.sender);
            houseFunds[currentSession].userCredits[msg.sender].exists = true;
        }
        houseFunds[currentSession].totalUserCredits = safeAdd(houseFunds[currentSession].totalUserCredits,
            adjustedCredits);
        houseFunds[currentSession].totalPurchasedUserCredits = safeAdd(houseFunds[currentSession].totalPurchasedUserCredits,
            adjustedCredits);
        houseFunds[currentSession].totalFunds = safeAdd(houseFunds[currentSession].totalFunds,
            adjustedCredits);

        houseFunds[previousSession].totalUserCredits = safeSub(houseFunds[previousSession].totalUserCredits,
            rolledOverFromPreviousSession);
        houseFunds[previousSession].totalFunds = safeSub(houseFunds[previousSession].totalFunds,
            rolledOverFromPreviousSession);

        for(uint i = 0; i < sessions[currentSession].offerings.length; i++) {
            address houseOffering = sessions[currentSession].offerings[i];
            uint allocation = sessions[currentSession].offeringTokenAllocations[houseOffering].allocation;
            uint tokenAmount = safeDiv(safeMul(adjustedCredits, allocation), 100);

            if(!decentBetToken.approve(houseOffering, tokenAmount))
                revert();

            if(!offerings[houseOffering].houseOffering.houseDeposit(tokenAmount, currentSession))
                revert();

            LogOfferingDeposit(currentSession, houseOffering, allocation, tokenAmount);
        }

        allotLotteryTickets(currentSession, adjustedCredits);

        LogClaimRolledOverCredits(msg.sender, currentSession, rolledOverFromPreviousSession, adjustedCredits,
            houseFunds[currentSession].userCredits[msg.sender].amount);
    }

    // Withdraws session tokens for the previously ended session from a house offering.
    function withdrawPreviousSessionTokensFromHouseOffering(address houseOffering)
    isValidHouseOffering(houseOffering)
    onlyAuthorized {
        uint previousSession = currentSession - 1;
        // Withdrawals are only allowed after session 1.
        if(currentSession <= 1) revert();

        // Tokens can only be withdrawn from offerings by house 48h after the previous session has ended to account
        // for pending bets/game outcomes.
        if(getTime() < sessions[previousSession].endTime + 2 days) revert();

        // If offering has already been withdrawn, revert.
        if(sessions[previousSession].withdrawnOfferings[houseOffering]) revert();

        uint previousSessionTokens = offerings[houseOffering].houseOffering.balanceOf(houseOffering, previousSession);

        houseFunds[previousSession].totalWithdrawn =
        safeAdd(houseFunds[previousSession].totalWithdrawn, previousSessionTokens);

        sessions[previousSession].withdrawnOfferings[houseOffering] = true;
        sessions[previousSession].withdrawCount += 1;

        // All offerings have been withdrawn.
        if(sessions[previousSession].withdrawCount == sessions[previousSession].offerings.length) {
            // If totalWithdrawn is greater than totalFunds, calculate the session profit.
            // Otherwise this would throw thanks to safeSub and disallowing signed int for uint.
            if(houseFunds[previousSession].totalWithdrawn > houseFunds[previousSession].totalFunds)
                houseFunds[previousSession].profit = safeAdd(houseFunds[previousSession].profit,
                safeSub(houseFunds[previousSession].totalWithdrawn, houseFunds[previousSession].totalFunds));
        }

        // Withdraw from previous session
        if(!offerings[houseOffering].houseOffering.withdrawPreviousSessionTokens()) revert();
    }

    // Allow authorized addresses to add profits for offerings that haven't been registered
    // with the house for the current session.
    function addToSessionProfitsFromUnregisteredHouseOffering(address unregisteredOffering,
                                                              uint session,
                                                              uint amount)
    onlyAuthorized {
        // Session zero doesn't have profits
        if(currentSession == 0) revert();

        // Can only be for current and previous sessions
        if(session != currentSession && session != (currentSession - 1)) revert();

        // Check if a balance is available with offering
        if(decentBetToken.balanceOf(msg.sender) < amount) revert();

        // Add to totalUnregisteredOfferingProfits for the session
        houseFunds[session].totalUnregisteredOfferingProfits =
                safeAdd(houseFunds[session].totalUnregisteredOfferingProfits, amount);

        // Add to profit for the session
        houseFunds[session].profit = safeAdd(houseFunds[session].profit, amount);
    }

    // Allocates a %age of tokens for a house offering for the next session
    function allocateTokensForHouseOffering(uint percentage, address houseOffering)
    isCreditBuyingPeriod
    isValidHouseOffering(houseOffering)
    onlyAuthorized {
        uint nextSession = currentSession + 1;

        // Total %age of tokens can't be above 100.
        if(safeAdd(sessions[nextSession].totalTokensAllocated, percentage) > 100) revert();

        // Tokens have already been deposited to offering.
        if(sessions[nextSession].offeringTokenAllocations[houseOffering].deposited) revert();

        uint previousAllocation = sessions[nextSession].offeringTokenAllocations[houseOffering].allocation;

        sessions[nextSession].offeringTokenAllocations[houseOffering].allocation = percentage;
        sessions[nextSession].totalTokensAllocated =
        safeSub(safeAdd(sessions[nextSession].totalTokensAllocated, percentage), previousAllocation);

        LogOfferingAllocation(nextSession, houseOffering, percentage);
    }

    function depositAllocatedTokensToHouseOffering(address houseOffering)
    isLastWeekForSession
    isValidHouseOffering(houseOffering)
    onlyAuthorized {
        uint nextSession = currentSession + 1;

        // Tokens have already been deposited to offering.
        if(sessions[nextSession].offeringTokenAllocations[houseOffering].deposited)
            revert();

        uint allocation = sessions[nextSession].offeringTokenAllocations[houseOffering].allocation;

        uint tokenAmount = safeDiv(safeMul(houseFunds[nextSession].totalFunds, allocation), 100);

        sessions[nextSession].offeringTokenAllocations[houseOffering].deposited = true;
        sessions[nextSession].depositedAllocations = safeAdd(sessions[nextSession].depositedAllocations, 1);

        if(!decentBetToken.approve(houseOffering, tokenAmount))
            revert();

        if(!offerings[houseOffering].houseOffering.houseDeposit(tokenAmount, nextSession))
            revert();

        LogOfferingDeposit(nextSession, houseOffering, allocation, tokenAmount);
    }

    // Get house lottery to retrieve random ticket winner using oraclize as RNG.
    function pickLotteryWinner(uint session)
    isProfitDistributionPeriod(session)
    isLotteryNotFinalized(session)
    onlyAuthorized payable {
        // TODO: Send with ether value to fund oraclize
        if(!houseLottery.pickWinner(currentSession, lotteries[currentSession].ticketCount)) revert();
        LogPickLotteryWinner(currentSession, lotteries[currentSession].ticketCount);
    }

    // Called after oraclize has updated lottery winner.
    function updateWinningLotteryTicket(uint session)
    isProfitDistributionPeriod(session)
    isLotteryNotFinalized(session)
    onlyAuthorized {
        uint winningTicket = houseLottery.getWinningLotteryTicket(currentSession);
        lotteries[session].winningTicket = winningTicket;
        lotteries[session].finalized = true;
        LogWinningTicket(currentSession, winningTicket, lotteryTicketHolders[session][winningTicket]);
    }

    // Allows a winner to withdraw lottery winnings.
    function withdrawLotteryWinnings(uint session)
    isProfitDistributionPeriod(session) {
        // Should only work after the winning number has been finalized.
        if(!lotteries[session].finalized) revert();
        // Should not work if winnings have already been claimed.
        if(lotteries[session].claimed) revert();
        // Only holder of the winning ticket can withdraw.
        if(lotteryTicketHolders[session][lotteries[session].winningTicket] != msg.sender) revert();

        uint payoutPerCredit = getPayoutPerCredit(session);
        uint lotteryPayout = safeDiv(safeMul(houseFunds[session].totalPurchasedUserCredits, 5), 100);

        lotteries[session].payout = lotteryPayout;
        lotteries[session].claimed = true;

        if(!decentBetToken.transfer(msg.sender, lotteryPayout)) revert();
    }

    // Starts the next session.
    // Call this function once after setting up the house to begin the initial credit buying period.
    function beginNextSession()
    isEndOfSession
    onlyAuthorized {
        uint nextSession = safeAdd(currentSession, 1);
        sessions[currentSession].active = false;
        if (currentSession == 0 && sessionZeroStartTime == 0) {
            // Session zero starts here and allows users to buy credits for a week before starting session 1.
            sessionZeroStartTime = getTime();
            sessions[currentSession].startTime = getTime();
            // TODO: Change to 2 weeks for prod
            sessions[currentSession].endTime = safeAdd(sessions[currentSession].startTime, 2 weeks);

            LogNewSession(currentSession, sessions[currentSession].startTime, 0, sessions[currentSession].endTime, 0);
        } else {
            sessions[nextSession].startTime = getTime();
            sessions[nextSession].endTime = safeAdd(sessions[nextSession].startTime, 12 weeks);
            // For a session to be considered active, getTime() would need to be between startTime and endTime
            // AND session should be active.
            sessions[nextSession].active = true;
            currentSession = nextSession;

            // All offerings should have allocated tokens deposited before switching to next session.
            if(sessions[nextSession].depositedAllocations != sessions[nextSession].offerings.length) revert();

            for(uint i = 0; i < offeringAddresses.length; i++)
                offerings[offeringAddresses[i]].houseOffering.setSession(nextSession);

            LogNewSession(nextSession, sessions[nextSession].startTime, 0, sessions[nextSession].endTime, 0);
        }
    }

    // Utility functions for front-end purposes.
    function getUserCreditsForSession(uint session, address _address) constant
    returns (uint amount, uint liquidated, uint rolledOverToNextSession, uint claimedFromPreviousSession,
        uint totalFunds, uint totalUserCredits) {
        return (houseFunds[session].userCredits[_address].amount,
        houseFunds[session].userCredits[_address].liquidated,
        houseFunds[session].userCredits[_address].rolledOverToNextSession,
        houseFunds[session].userCredits[_address].claimedFromPreviousSession,
        houseFunds[session].totalFunds,
        houseFunds[session].totalUserCredits);
    }

    function getSessionTime(uint session) constant returns (uint, uint) {
        return (sessions[session].startTime, sessions[session].endTime);
    }

    function doesOfferingExist(address _offering) constant returns (bool) {
        return offerings[_offering].exists;
    }

    function getUserForSession(uint session, uint index) constant returns (address _address) {
        return houseFunds[session].users[index];
    }

    function getSessionOffering(uint session, uint index) constant returns (address offering) {
        return sessions[session].offerings[index];
    }

    function getOfferingTokenAllocations(uint session, address _address) constant returns (uint, bool) {
        return (sessions[session].offeringTokenAllocations[_address].allocation,
        sessions[session].offeringTokenAllocations[_address].deposited);
    }

    // Do not accept ETH sent to this contract.
    function() {
        revert();
    }

}