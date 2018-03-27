pragma solidity ^0.4.0;

import './AbstractHouse.sol';
import './../Token/ERC20.sol';
import './../Libraries/SafeMath.sol';

// All functionality related to house funds reside here
contract HouseFundsController is SafeMath {

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

    // Variables
    AbstractHouse house;
    ERC20 public decentBetToken;

    bool public isHouseFundsController = true;
    uint public constant PROFIT_SHARE_PERCENT = 95;
    uint public MIN_CREDIT_PURCHASE = 1000 ether;

    // Mappings
    // House funds per session
    mapping (uint => HouseFunds) public houseFunds;

    // Constructor
    function HouseFundsController(address _house){
        if(_house == 0x0) revert();
        house = AbstractHouse(_house);
        decentBetToken = ERC20(house.decentBetToken());
    }

    // Modifiers
    modifier isAuthorized() {
        if(!house.authorized(msg.sender)) revert();
        _;
    }

    modifier onlyHouse() {
        if(msg.sender != address(house)) revert();
        _;
    }

    // Allows functions to execute only if users have "amount" credits available for "session".
    modifier areCreditsAvailable(address _address, uint session, uint amount) {
        if (houseFunds[session].userCredits[_address].amount < amount) revert();
        _;
    }

    // Allows functions to execute only if users have "amount" tokens in their balance.
    modifier areTokensAvailable(address _address, uint amount) {
        if (decentBetToken.balanceOf(_address) < amount) revert();
        _;
    }

    // Allows functions to execute only if rolled over credits from the previous session are available.
    modifier areRolledOverCreditsAvailable(address _address) {
        if (houseFunds[house.currentSession()].userCredits[_address].rolledOverFromPreviousSession == 0) revert();
        _;
    }

    // Functions
    // Transfers DBETs from users to house contract address and generates credits in return.
    // House contract must be approved to transfer amount from msg.sender to house.
    function purchaseCredits(address _address, uint amount)
    areTokensAvailable(_address, amount)
    onlyHouse returns (uint)
    {
        if(!house.isCreditBuyingPeriod()) revert();

        // The minimum credit purchase needs to be 1000 DBETs
        if(amount < MIN_CREDIT_PURCHASE) revert();
        if(decentBetToken.allowance(_address, address(house)) < amount) revert();

        // Issue credits to user equivalent to amount transferred.
        uint nextSession = safeAdd(house.currentSession(), 1);

        // Add to house and user funds.
        houseFunds[nextSession].totalFunds =
        safeAdd(houseFunds[nextSession].totalFunds, amount);
        houseFunds[nextSession].totalPurchasedUserCredits =
        safeAdd(houseFunds[nextSession].totalPurchasedUserCredits, amount);
        houseFunds[nextSession].totalUserCredits =
        safeAdd(houseFunds[nextSession].totalUserCredits, amount);
        houseFunds[nextSession].userCredits[_address].amount =
        safeAdd(houseFunds[nextSession].userCredits[_address].amount, amount);

        // Add user to house users array for UI iteration purposes.
        if (houseFunds[nextSession].userCredits[_address].exists == false) {
            houseFunds[nextSession].users.push(_address);
            houseFunds[nextSession].userCredits[_address].exists = true;
        }

        return houseFunds[nextSession].userCredits[msg.sender].amount;
    }


    // Allows users holding credits in the current session to roll over their credits to the
    // next session.
    function rollOverCredits(address _address, uint amount)
    areCreditsAvailable(_address, house.currentSession(), amount)
    onlyHouse returns (bool) {
        if(!house.isCreditBuyingPeriod()) revert();

        uint currentSession = house.currentSession();
        if (currentSession == 0) revert();

        // Payout and current session variables.
        uint available = houseFunds[currentSession].userCredits[_address].amount;
        uint rolledOverToNextSession = houseFunds[currentSession].userCredits[_address]
        .rolledOverToNextSession;
        uint rolledOverFromPreviousSession = houseFunds[currentSession].userCredits[_address]
        .rolledOverFromPreviousSession;

        // Next session variables.
        uint nextSession = safeAdd(currentSession, 1);

        // Rollover credits from current session to next.
        houseFunds[currentSession].userCredits[_address].amount = safeSub(available, amount);
        houseFunds[currentSession].userCredits[_address].rolledOverToNextSession =
        safeAdd(rolledOverToNextSession, amount);

        // Add to credits for next session.
        houseFunds[nextSession].userCredits[_address].rolledOverFromPreviousSession =
        safeAdd(rolledOverFromPreviousSession, amount);

        return true;
    }

    function liquidateCredits(address _address, uint session) onlyHouse returns (uint, uint) {
        if(houseFunds[session].userCredits[_address].amount == 0) revert();

        // Payout variables
        uint payoutPerCredit = getPayoutPerCredit(session);
        uint amount = houseFunds[session].userCredits[_address].amount;
        // (Payout per credit * amount of credits)
        uint payout = safeDiv(safeMul(payoutPerCredit, amount), 1 ether);

        // Payout users for current session and liquidate credits.
        houseFunds[session].payouts[_address] =
            safeAdd(houseFunds[session].payouts[_address], payout);
        houseFunds[session].totalUserCredits =
            safeSub(houseFunds[session].totalUserCredits, amount);
        houseFunds[session].totalFunds =
            safeSub(houseFunds[session].totalFunds, amount);
        houseFunds[session].userCredits[_address].amount =
            safeSub(houseFunds[session].userCredits[_address].amount, amount);
        houseFunds[session].userCredits[_address].liquidated =
            safeAdd(houseFunds[session].userCredits[_address].liquidated, amount);
        houseFunds[session].totalHousePayouts =
            safeAdd(houseFunds[session].totalHousePayouts, payout);

        return (payout, amount);
    }

    function claimRolledOverCredits(address _address) onlyHouse returns (uint, uint, uint) {
        uint currentSession = house.currentSession();
        uint previousSession = currentSession - 1;
        uint rolledOverFromPreviousSession = houseFunds[currentSession].userCredits[_address]
        .rolledOverFromPreviousSession;

        // Multiply by credits : tokens ratio from previous session to get adjusted credits for new session
        uint prevTotalPurchasedUserCredits = houseFunds[previousSession].totalPurchasedUserCredits;
        uint prevTotalWithdrawn = houseFunds[previousSession].totalWithdrawn;

        uint adjustedCredits = safeDiv(safeMul(rolledOverFromPreviousSession, prevTotalWithdrawn),
            prevTotalPurchasedUserCredits);
        uint userSessionCredits = houseFunds[currentSession].userCredits[_address].amount;

        houseFunds[currentSession].userCredits[_address].claimedFromPreviousSession = adjustedCredits;
        houseFunds[currentSession].userCredits[_address].rolledOverFromPreviousSession = 0;

        houseFunds[currentSession].userCredits[_address].amount = safeAdd(userSessionCredits, adjustedCredits);
        if (houseFunds[currentSession].userCredits[_address].exists == false) {
            houseFunds[currentSession].users.push(_address);
            houseFunds[currentSession].userCredits[_address].exists = true;
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

        return (adjustedCredits,
                rolledOverFromPreviousSession,
                houseFunds[currentSession].userCredits[_address].amount);
    }

    function getPayoutPerCredit(uint session) constant returns (uint) {

        uint totalWithdrawn = houseFunds[session].totalWithdrawn;
        uint totalUnregisteredOfferingProfits = houseFunds[session].totalUnregisteredOfferingProfits;

        uint totalPayout = safeAdd(totalWithdrawn, totalUnregisteredOfferingProfits);
        uint totalPurchasedUserCredits = houseFunds[session].totalPurchasedUserCredits;

        // ((User Credits / Total User Credits) * Total Withdrawn) * PROFIT_SHARE_PERCENT/100;
        return safeDiv(safeMul(safeMul(1 ether, totalPayout), PROFIT_SHARE_PERCENT),
            safeMul(totalPurchasedUserCredits, 100));
    }

    function addToSessionProfitsFromUnregisteredHouseOffering(address unregisteredOffering,
        uint session,
        uint amount) onlyHouse returns (bool) {
        // Add to totalUnregisteredOfferingProfits for the session
        houseFunds[session].totalUnregisteredOfferingProfits =
        safeAdd(houseFunds[session].totalUnregisteredOfferingProfits, amount);

        // Add to profit for the session
        houseFunds[session].profit = safeAdd(houseFunds[session].profit, amount);

        return true;
    }

    function withdrawPreviousSessionTokensFromHouseOffering(
        address houseOffering, uint previousSessionTokens, bool allOfferingsWithdrawn)
    onlyHouse returns (bool) {
        uint previousSession = house.currentSession() - 1;
        houseFunds[previousSession].totalWithdrawn =
        safeAdd(houseFunds[previousSession].totalWithdrawn, previousSessionTokens);

        if(allOfferingsWithdrawn)
            houseFunds[previousSession].profit = safeAdd(houseFunds[previousSession].profit,
                safeSub(houseFunds[previousSession].totalWithdrawn, houseFunds[previousSession].totalFunds));

        return true;
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

    function getUserForSession(uint session, uint index) constant returns (address _address) {
        return houseFunds[session].users[index];
    }



}
