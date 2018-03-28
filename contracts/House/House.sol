pragma solidity ^0.4.8;

import '../Libraries/SafeMath.sol';
import '../Token/ERC20.sol';
import './AbstractHouseLottery.sol';
import '../Betting/AbstractSportsOracle.sol';
import './HouseOffering.sol';
import '../Libraries/TimeProvider.sol';
import '../Libraries/EmergencyOptions.sol';
import './AbstractHouseFundsController.sol';


// Decent.bet House Contract.
// All credits and payouts are in DBETs and are 18 decimal places in length.
contract House is SafeMath, TimeProvider, EmergencyOptions {

    // Structs
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
    ERC20 public decentBetToken;

    AbstractHouseLottery public houseLottery;

    AbstractHouseFundsController houseFundsController;

    // Mappings
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
        decentBetToken = ERC20(decentBetTokenAddress);

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

    modifier isHouseFundsControllerSet() {
        if(!houseFundsController.isHouseFundsController()) revert();
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

    // Allows functions to execute if they happen during an "active" period for a session i.e,
    // Not during a credit buying/token allocation period
    modifier isSessionActivePeriod() {
        if(currentSession == 0) revert();
        if(getTime() < sessions[currentSession].startTime ||
        getTime() > (sessions[currentSession].endTime - 2 weeks)) revert();
        _;
    }

    // Events
    event LogPurchasedCredits(address creditHolder, uint session, uint amount, uint balance);

    event LogLiquidateCredits(address creditHolder, uint session, uint amount, uint payout);

    event LogRolledOverCredits(address creditHolder, uint session, uint amount);

    event LogClaimRolledOverCredits(address creditHolder, uint session, uint rolledOver, uint adjusted,
        uint creditsForCurrentSession);

    event LogNewSession(uint session, uint startTimestamp, uint startBlockNumber, uint endTimestamp, uint endBlockNumber);

    event LogNewHouseOffering(address offeringAddress, bytes32 name);

    event LogPickLotteryWinner(uint session);

    event LogWinningTicket(uint session, uint ticketNumber, address _address);

    event LogOfferingAllocation(uint session, address offering, uint percentage);

    event LogOfferingDeposit(uint session, address offering, uint percentage, uint amount);

    event LogEmergencyWithdraw(address creditHolder, uint session, uint amount, uint payout);

    // Sets the house funds controller address.
    function setHouseFundsControllerAddress(address houseFundsControllerAddress) onlyFounder {
        if(houseFundsControllerAddress == 0x0) revert();
        if(!AbstractHouseFundsController(houseFundsControllerAddress).isHouseFundsController()) revert();
        houseFundsController = AbstractHouseFundsController(houseFundsControllerAddress);
    }

    // Sets the lottery address.
    function setHouseLotteryAddress(address houseLotteryAddress)
    onlyFounder {
        if(houseLotteryAddress == 0x0) revert();
        if(!AbstractHouseLottery(houseLotteryAddress).isHouseLottery()) revert();
        houseLottery = AbstractHouseLottery(houseLotteryAddress);
    }

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
        if(houseOfferingAddress == 0x0) revert();
        // Not a house offering
        if(!HouseOffering(houseOfferingAddress).isHouseOffering())
            revert();

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
    isValidHouseOffering(houseOfferingAddress) internal
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
        offerings[houseOfferingAddress].exists = false;
    }

    // Transfers DBETs from users to house contract address and generates credits in return.
    // House contract must be approved to transfer amount from msg.sender to house.
    function purchaseCredits(uint amount)
    isNotEmergencyPaused
    isHouseFundsControllerSet
    {
        uint userCredits = houseFundsController.purchaseCredits(msg.sender, amount);
        uint nextSession = currentSession + 1;

        if(!houseLottery.allotLotteryTickets(nextSession, msg.sender, amount)) revert();

        // Transfer tokens to house contract address.
        if (!decentBetToken.transferFrom(msg.sender, address(this), amount)) revert();

        LogPurchasedCredits(msg.sender, nextSession, amount, userCredits);
    }

    // Allows users to return credits and receive tokens along with profit in return.
    function liquidateCredits(uint session)
    isNotEmergencyPaused
    isHouseFundsControllerSet
    isProfitDistributionPeriod(session) {
        uint payout;
        uint amount;

        (payout, amount) = houseFundsController.liquidateCredits(msg.sender, session);

        // Transfers from house to user.
        if (!decentBetToken.transfer(msg.sender, payout)) revert();

        LogLiquidateCredits(msg.sender, session, amount, payout);
    }

    // Returns the payout per credit based on the house winnings for a session.

    /* NOTE:
        Since solidity cannot handle floating point types, to avoid instances where the payout per credit may lose value
        due to loss of precision with using 1 as the base amount - The resulting payoutPerCredit uses 1 ether as a base
        amount which means that the resulting payoutPerCredit would have to be multiplied by the actual amount
        of credits and then divided by 1 ether to get the final payout amount.
    */

    // Allows users holding credits in the current session to roll over their credits to the
    // next session.
    function rollOverCredits(uint amount)
    isNotEmergencyPaused
    isCreditBuyingPeriod
    isHouseFundsControllerSet {
        if(!houseFundsController.rollOverCredits(msg.sender, amount)) revert();

        LogRolledOverCredits(msg.sender, currentSession, amount);
    }

    function claimRolledOverCredits()
    isNotEmergencyPaused
    isSessionActivePeriod
    isHouseFundsControllerSet {
        uint adjustedCredits;
        uint rolledOverFromPreviousSession;
        uint creditsForCurrentSession;

        (adjustedCredits, rolledOverFromPreviousSession, creditsForCurrentSession) =
            houseFundsController.claimRolledOverCredits(msg.sender);

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

        if (!houseLottery.allotLotteryTickets(currentSession, msg.sender, adjustedCredits)) revert();

        LogClaimRolledOverCredits(msg.sender, currentSession, rolledOverFromPreviousSession, adjustedCredits,
            creditsForCurrentSession);
    }

    // Withdraws session tokens for the previously ended session from a house offering.
    function withdrawPreviousSessionTokensFromHouseOffering(address houseOffering)
    isValidHouseOffering(houseOffering)
    isHouseFundsControllerSet
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

        sessions[previousSession].withdrawnOfferings[houseOffering] = true;
        sessions[previousSession].withdrawCount += 1;

        // All offerings have been withdrawn.
        bool allOfferingsWithdrawn =
                sessions[previousSession].withdrawCount == sessions[previousSession].offerings.length;

        houseFundsController.withdrawPreviousSessionTokensFromHouseOffering(
            houseOffering,
            previousSessionTokens,
            allOfferingsWithdrawn
        );

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

        if(decentBetToken.allowance(msg.sender, address(this)) < amount) revert();

        houseFundsController
            .addToSessionProfitsFromUnregisteredHouseOffering(unregisteredOffering, session, amount);

        if(!decentBetToken.transferFrom(msg.sender, address(this), amount)) revert();
    }

    // Allocates a %age of tokens for a house offering for the next session
    function allocateTokensForHouseOffering(uint percentage, address houseOffering)
    isValidHouseOffering(houseOffering)
    isCreditBuyingPeriod
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
    isHouseFundsControllerSet
    onlyAuthorized {
        uint nextSession = currentSession + 1;

        // Tokens have already been deposited to offering.
        if(sessions[nextSession].offeringTokenAllocations[houseOffering].deposited)
            revert();

        uint allocation = sessions[nextSession].offeringTokenAllocations[houseOffering].allocation;

        uint totalSessionFunds;
        (totalSessionFunds,,,,,,) = houseFundsController.houseFunds(nextSession);

        uint tokenAmount = safeDiv(safeMul(totalSessionFunds, allocation), 100);

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
    onlyAuthorized
    isProfitDistributionPeriod(session) payable returns (bool) {
        // Should only work if the winning number has not been finalized.
        if(houseLottery.isLotteryFinalized(session)) revert();
        // TODO: Send with ether value to fund oraclize
        if(!houseLottery.pickWinner(currentSession)) revert();
        LogPickLotteryWinner(currentSession);

        return true;
    }

    // Allows a winner to withdraw lottery winnings.
    function claimLotteryWinnings(uint session)
    isHouseFundsControllerSet
    isProfitDistributionPeriod(session) constant returns (uint, uint){
        // Should only work after the winning number has been finalized.
        if(!houseLottery.isLotteryFinalized(session)) revert();
        // Should not work if the winnings have already been claimed.
        if(houseLottery.isLotteryClaimed(session)) revert();
        // Only holder of the winning ticket can withdraw.
        if(houseLottery.getLotteryWinner(session) != msg.sender) revert();

        uint totalProfit;
        (,,,,,,totalProfit) = houseFundsController.houseFunds(session);

        if(totalProfit == 0) revert();

        uint lotteryPayout = safeDiv(safeMul(totalProfit, 5), 100);

        // TODO: Fit this in without running into gas limits
//        if(!houseLottery.updateLotteryPayout(session, lotteryPayout)) revert();
//
//        if(!decentBetToken.transfer(msg.sender, lotteryPayout)) revert();

        return (totalProfit, lotteryPayout);
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

    // Emergency features

    // Emergency withdraws current session tokens from a house offering.
    function emergencyWithdrawCurrentSessionTokensFromHouseOffering(address houseOffering)
    isValidHouseOffering(houseOffering)
    isHouseFundsControllerSet
    isEmergencyPaused
    onlyAuthorized {
        // If offering has already been withdrawn, revert.
        if(sessions[currentSession].withdrawnOfferings[houseOffering]) revert();

        uint sessionTokens = offerings[houseOffering].houseOffering.balanceOf(houseOffering, currentSession);

        sessions[currentSession].withdrawnOfferings[houseOffering] = true;
        sessions[currentSession].withdrawCount += 1;

        // All offerings have been withdrawn.
        bool allOfferingsWithdrawn =
        sessions[currentSession].withdrawCount == sessions[currentSession].offerings.length;

        houseFundsController.emergencyWithdrawCurrentSessionTokensFromHouseOffering(
            houseOffering,
            sessionTokens,
            allOfferingsWithdrawn
        );

        // Withdraw from previous session
        if(!offerings[houseOffering].houseOffering.emergencyWithdrawCurrentSessionTokens()) revert();
    }

    function getSessionTime(uint session) constant returns (uint, uint) {
        return (sessions[session].startTime, sessions[session].endTime);
    }

    function isSessionActive(uint session) constant returns (bool) {
        return getTime() >= sessions[session].startTime &&
               getTime() <= sessions[session].endTime;
    }

    function doesOfferingExist(address _offering) constant returns (bool) {
        return offerings[_offering].exists;
    }

    function getSessionOffering(uint session, uint index) constant returns (address offering) {
        return sessions[session].offerings[index];
    }

    function getOfferingTokenAllocations(uint session, address _address) constant returns (uint, bool) {
        return (sessions[session].offeringTokenAllocations[_address].allocation,
        sessions[session].offeringTokenAllocations[_address].deposited);
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

    // Allows functions to execute only if the profit distribution period is going on i.e
    // after the end of the previous session and after all offering credits have been withdrawn.
    modifier isProfitDistributionPeriod(uint session) {
        if (session == 0) revert();
        if (getTime() < (sessions[session].endTime + 4 days)) revert();
        if (sessions[session].withdrawCount != sessions[session].offerings.length) revert();
        _;
    }

    // Do not accept ETH sent to this contract.
    function() {
        revert();
    }

}
