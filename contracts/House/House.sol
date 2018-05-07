pragma solidity 0.4.21;

import "../Libraries/SafeMath.sol";
import "../Token/ERC20.sol";
import "../Libraries/EmergencyOptions.sol";
import "../Libraries/TimeProvider.sol";

import "./HouseOffering.sol";

import "./Controllers/HouseAuthorizedController.sol";
import "./Controllers/HouseFundsController.sol";
import "./Controllers/HouseLotteryController.sol";
import "./Controllers/HouseSessionsController.sol";

import "../Kyc/KycManager.sol";

// Decent.bet House Contract.
// All credits and payouts are in DBETs and are 18 decimal places in length.
contract House is SafeMath, EmergencyOptions, TimeProvider {

    // Variables
    address public founder;

    // Starting session will be at 0.
    // This would be the credit buying period for the 1st session of the house and lasts only for 1 week.
    uint public currentSession = 0;

    // Time session 0 begins.
    uint public sessionZeroStartTime = 0;

    // External Contracts
    ERC20 public decentBetToken;
    HouseLotteryController public houseLotteryController;
    HouseAuthorizedController houseAuthorizedController;
    HouseFundsController houseFundsController;
    HouseSessionsController houseSessionsController;
    KycManager kycManager;

    // Constructor
    function House(address decentBetTokenAddress, address kycManagerAddress)
    public {
        require(decentBetTokenAddress != 0x0);
        founder = msg.sender;
        decentBetToken = ERC20(decentBetTokenAddress);
        kycManager = KycManager(kycManagerAddress);

        // If on local testRPC/testnet and need to set mock times
        // Leave this here for development purposes.
        // TODO: Remove TimeProvider before publishing to mainnet.
        isMock = true;
        setTimeController(msg.sender);
    }

    // Modifiers //
    modifier onlyFounder() {
        require(msg.sender == founder);
        _;
    }

    modifier onlyAuthorized() {
        require(houseAuthorizedController.authorized(msg.sender));
        _;
    }

    // If this is the last week of a session - signifying the period when token deposits can be made to house offerings.
    modifier isLastWeekForSession() {
        uint endTime;
        (,endTime) = houseSessionsController.getSessionTimes(currentSession);
        if(currentSession == 0)
            require(sessionZeroStartTime > 0);
        require(getTime() >= (safeSub(endTime, 1 weeks)) && getTime() <= (endTime));
        _;
    }

    // Allows functions to execute only if users have "amount" tokens in their balance.
    modifier areTokensAvailable(uint amount) {
        require(decentBetToken.balanceOf(msg.sender) >= amount);
        _;
    }

    // Allows functions to execute only if it is the end of the current session.
    modifier isEndOfSession() {
        uint endTime;
        (,endTime) = houseSessionsController.getSessionTimes(currentSession);
        require((currentSession == 0 && endTime == 0) || getTime() >= endTime);
        _;
    }

    // Allows functions to execute if they happen during an "active" period for a session i.e,
    // Not during a credit buying/token allocation period
    modifier isSessionActivePeriod() {
        require(currentSession > 0);
        uint startTime;
        uint endTime;
        (startTime,endTime) = houseSessionsController.getSessionTimes(currentSession);
        require(getTime() >= startTime && getTime() <= (endTime - 2 weeks));
        _;
    }

    // Allows functions to execute only if it's currently a credit-buying period i.e
    // 1 week before the end of the current session.
    modifier isCreditBuyingPeriod() {
        if(currentSession == 0)
            require(sessionZeroStartTime != 0);
        uint endTime;
        (,endTime) = houseSessionsController.getSessionTimes(currentSession);
        require(
            getTime() >= (safeSub(endTime, 2 weeks)) &&
            getTime() <= (safeSub(endTime, 1 weeks))
        );
        _;
    }

    // Allows functions to execute only if the profit distribution period is going on i.e
    // after the end of the previous session and after all offering credits have been withdrawn.
    modifier isProfitDistributionPeriod(uint session) {
        require(session != 0);
        uint endTime;
        (,endTime,,,,,,) = houseSessionsController.sessions(session);
        require(getTime() >= (endTime + 4 days));
        require(houseSessionsController.haveAllOfferingsBeenWithdrawn(session));
        _;
    }

    // Allows functions to execute only if the session token allocation has been finalized
    modifier areSessionTokenAllocationsFinalized(uint session) {
        require(houseSessionsController.areSessionTokenAllocationsFinalized(session));
        _;
    }

    // Allows functions to execute only if all offerings have been withdrawn
    modifier haveAllOfferingsBeenWithdrawn(uint session) {
        require(session > 0);
        require(houseSessionsController.haveAllOfferingsBeenWithdrawn(session));
        _;
    }

    // Allows functions to execute only if the sender has been KYC verified.
    modifier isSenderKycVerified() {
        require(kycManager.isVerified(address(this), msg.sender));
        _;
    }

    // Events
    event LogPurchasedCredits(
        address creditHolder,
        uint session,
        uint amount,
        uint balance
    );

    event LogLiquidateCredits(
        address creditHolder,
        uint session,
        uint amount,
        uint payout
    );

    event LogRolledOverCredits(
        address creditHolder,
        uint session,
        uint amount
    );

    event LogClaimRolledOverCredits(
        address creditHolder,
        uint session,
        uint rolledOver,
        uint adjusted,
        uint creditsForCurrentSession
    );

    event LogNewSession(
        uint session,
        uint startTimestamp,
        uint startBlockNumber,
        uint endTimestamp,
        uint endBlockNumber
    );

    event LogNewHouseOffering(
        address offeringAddress,
        bytes32 name
    );

    event LogPickLotteryWinner(uint session);

    event LogWinningTicket(
        uint session,
        uint ticketNumber,
        address _address
    );

    event LogOfferingAllocation(
        uint session,
        address offering,
        uint percentage
    );

    event LogFinalizedTokenAllocations(
        uint session
    );

    event LogOfferingDeposit(
        uint session,
        address offering,
        uint percentage,
        uint amount
    );

    event LogAddToSessionProfitsFromUnregisteredHouseOffering(
        uint session,
        address offering,
        uint amount
    );

    event LogEmergencyWithdraw(
        address creditHolder,
        uint session,
        uint amount,
        uint payout
    );

    // Sets the house funds controller address.
    function setHouseAuthorizedControllerAddress(address _address)
    public
    onlyFounder {
        require(_address != 0x0);
        require(HouseAuthorizedController(_address).isHouseAuthorizedController());
        houseAuthorizedController = HouseAuthorizedController(_address);
    }

    // Sets the house funds controller address.
    function setHouseFundsControllerAddress(address _address)
    public
    onlyFounder {
        require(_address != 0x0);
        require(HouseFundsController(_address).isHouseFundsController());
        houseFundsController = HouseFundsController(_address);
    }

    // Sets the house sessions controller address.
    function setHouseSessionsControllerAddress(address _address)
    public
    onlyFounder {
        require(_address != 0x0);
        require(HouseSessionsController(_address).isHouseSessionsController());
        houseSessionsController = HouseSessionsController(_address);
    }

    // Sets the lottery address.
    function setHouseLotteryControllerAddress(address _address)
    public
    onlyFounder {
        require(_address != 0x0);
        require(HouseLotteryController(_address).isHouseLotteryController());
        houseLotteryController = HouseLotteryController(_address);
    }

    // Transfers DBETs from users to house contract address and generates credits in return.
    // House contract must be approved to transfer amount from msg.sender to house.
    function purchaseCredits(uint amount)
    public
    isSenderKycVerified
    isNotEmergencyPaused
    isCreditBuyingPeriod {
        uint userCredits = houseFundsController.purchaseCredits(msg.sender, amount);
        uint nextSession = currentSession + 1;

        if(!houseLotteryController.allotLotteryTickets(nextSession, msg.sender, amount)) revert();

        // Transfer tokens to house contract address.
        if (!decentBetToken.transferFrom(msg.sender, address(this), amount)) revert();

        emit LogPurchasedCredits(msg.sender, nextSession, amount, userCredits);
    }

    // Allows users to return credits and receive tokens along with profit in return.
    function liquidateCredits(uint session)
    public
    isSenderKycVerified
    isNotEmergencyPaused
    isProfitDistributionPeriod(session) {
        uint payout;
        uint amount;

        (payout, amount) = houseFundsController.liquidateCredits(msg.sender, session);

        // Transfers from house to user.
        if (!decentBetToken.transfer(msg.sender, payout)) revert();

        emit LogLiquidateCredits(msg.sender, session, amount, payout);
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
    public
    isSenderKycVerified
    isNotEmergencyPaused
    isCreditBuyingPeriod {
        if(!houseFundsController.rollOverCredits(msg.sender, amount)) revert();

        emit LogRolledOverCredits(msg.sender, currentSession, amount);
    }

    // Allows users who've rolled over credits from a session to claim credits in the next session based on the
    // payout per credit for the previous session.
    function claimRolledOverCredits()
    public
    isNotEmergencyPaused
    isSessionActivePeriod
    haveAllOfferingsBeenWithdrawn(safeSub(currentSession, 1)) {
        uint adjustedCredits;
        uint rolledOverFromPreviousSession;
        uint creditsForCurrentSession;

        (adjustedCredits, rolledOverFromPreviousSession, creditsForCurrentSession) =
            houseFundsController.claimRolledOverCredits(msg.sender);

        for(uint i = 0; i < houseSessionsController.getSessionOfferingsLength(currentSession); i++) {
            address houseOffering = houseSessionsController.getSessionOffering(currentSession, i);
            uint allocation;
            (allocation,,) = houseSessionsController.getOfferingDetails(currentSession, houseOffering);
            uint tokenAmount = safeDiv(safeMul(adjustedCredits, allocation), 100);

            if(!decentBetToken.approve(houseOffering, tokenAmount))
                revert();

            if(!HouseOffering(houseOffering).houseDeposit(tokenAmount, currentSession))
                revert();

            emit LogOfferingDeposit(currentSession, houseOffering, allocation, tokenAmount);
        }

        if (!houseLotteryController.allotLotteryTickets(currentSession, msg.sender, adjustedCredits)) revert();

        emit LogClaimRolledOverCredits(msg.sender, currentSession, rolledOverFromPreviousSession, adjustedCredits,
            creditsForCurrentSession);
    }

    // Withdraws session tokens for the previously ended session from a house offering.
    function withdrawPreviousSessionTokensFromHouseOffering(address houseOffering)
    public
    onlyAuthorized {
        uint previousSessionTokens;
        bool allOfferingsWithdrawn;

        // Checks for getTime() >= previousSession + 2 days are made here
        (previousSessionTokens, allOfferingsWithdrawn) =
            houseSessionsController.withdrawPreviousSessionTokensFromHouseOffering(houseOffering);

        houseFundsController.withdrawPreviousSessionTokensFromHouseOffering(
            previousSessionTokens,
            allOfferingsWithdrawn
        );

        // Withdraw from previous session
        if(!HouseOffering(houseOffering).withdrawPreviousSessionTokens()) revert();
    }

    // Allow authorized addresses to add profits for offerings that haven't been registered
    // with the house for the current session.
    function addToSessionProfitsFromUnregisteredHouseOffering(
        address unregisteredOffering,
        uint session,
        uint amount
    )
    public
    onlyAuthorized {
        // Session zero doesn't have profits
        require(currentSession != 0);

        // Can only be for current and previous sessions
        require(session == currentSession || session == (safeSub(currentSession, 1)));

        // Check if a balance is available with offering
        require(decentBetToken.balanceOf(msg.sender) >= amount);

        // Sender must have allowance greater than the amount to be transferred
        require(decentBetToken.allowance(msg.sender, address(this)) >= amount);

        houseFundsController
            .addToSessionProfitsFromUnregisteredHouseOffering(session, amount);

        if(!decentBetToken.transferFrom(msg.sender, address(this), amount)) revert();

        emit LogAddToSessionProfitsFromUnregisteredHouseOffering(session, unregisteredOffering, amount);
    }

    // Allocates a %age of tokens for a house offering for the next session
    function allocateTokensForHouseOffering(uint percentage, address houseOffering)
    public
    isLastWeekForSession
    onlyAuthorized {
        if(!houseSessionsController.allocateTokensForHouseOffering(percentage, houseOffering)) revert();
        emit LogOfferingAllocation((currentSession + 1), houseOffering, percentage);
    }

    // Finalize token allocation among offerings for the next session
    function finalizeTokenAllocations()
    public
    isLastWeekForSession
    onlyAuthorized {
        if(!houseSessionsController.finalizeTokenAllocations()) revert();
        emit LogFinalizedTokenAllocations((currentSession + 1));
    }

    function depositAllocatedTokensToHouseOffering(address houseOffering)
    public
    isLastWeekForSession
    areSessionTokenAllocationsFinalized(currentSession + 1)
    onlyAuthorized {
        uint nextSession = currentSession + 1;

        uint totalSessionFunds;
        (totalSessionFunds,,,,,,) = houseFundsController.houseFunds(nextSession);

        uint allocation;
        (allocation,,) = houseSessionsController.getOfferingDetails(nextSession, houseOffering);

        uint tokenAmount = safeDiv(safeMul(totalSessionFunds, allocation), 100);

        if(!houseSessionsController.depositAllocatedTokensToHouseOffering(houseOffering))
            revert();

        if(!decentBetToken.approve(houseOffering, tokenAmount))
            revert();

        if(!HouseOffering(houseOffering).houseDeposit(tokenAmount, nextSession))
            revert();

        emit LogOfferingDeposit(nextSession, houseOffering, allocation, tokenAmount);
    }

    // Get house lottery to retrieve random ticket winner using oraclize as RNG.
    function pickLotteryWinner(uint session)
    public
    payable
    onlyAuthorized
    isProfitDistributionPeriod(session)
    returns (bool) {
        if(!houseLotteryController.pickWinner(currentSession)) revert();
        emit LogPickLotteryWinner(currentSession);
        return true;
    }

    // Allows a winner to withdraw lottery winnings.
    function claimLotteryWinnings(uint session)
    public
    isSenderKycVerified
    isProfitDistributionPeriod(session)
    returns (uint, uint){
        int sessionProfit = houseFundsController.getProfitForSession(session);

        require(sessionProfit > 0);

        uint uSessionProfit = (uint) (sessionProfit);

        uint lotteryPayout = safeDiv(safeMul(uSessionProfit, 5), 100);

        if(!houseLotteryController.updateLotteryPayout(session, msg.sender, lotteryPayout)) revert();

        if(!decentBetToken.transfer(msg.sender, lotteryPayout)) revert();

        return (uSessionProfit, lotteryPayout);
    }

    // Starts the next session.
    // Call this function once after setting up the house to begin the initial credit buying period.
    function beginNextSession()
    public
    isEndOfSession
    onlyAuthorized {
        uint nextSession = safeAdd(currentSession, 1);
        uint startTime;
        uint endTime;
        startTime = getTime();

        if (currentSession == 0 && sessionZeroStartTime == 0) {
            sessionZeroStartTime = getTime();
            endTime = safeAdd(startTime, 2 weeks);
            if(!houseSessionsController.beginNextSession(startTime, endTime, 0))
                revert();
            emit LogNewSession(currentSession, startTime, 0, endTime, 0);
        } else {
            currentSession = nextSession;
            endTime = safeAdd(startTime, 12 weeks);

            if(!houseSessionsController.beginNextSession(startTime, endTime, sessionZeroStartTime))
                revert();
            for(uint i = 0; i < houseSessionsController.getOfferingAddressesLength(); i++)
            // Offerings may be deleted from the next session i.e return 0x0. Ignore deleted offerings.
                if(houseSessionsController.offeringAddresses(i) != 0x0)
                    HouseOffering(houseSessionsController.offeringAddresses(i)).setSession(nextSession);

            emit LogNewSession(nextSession, startTime, 0, endTime, 0);
        }
    }

    // Emergency features
    // Emergency withdraws current session tokens from a house offering.
    function emergencyWithdrawCurrentSessionTokensFromHouseOffering(address houseOffering)
    public
    isEmergencyPaused
    onlyFounder {
        // If offering has already been withdrawn, revert.
        require(!houseSessionsController.isOfferingWithdrawn(currentSession, houseOffering));

        uint sessionTokens;
        bool allOfferingsWithdrawn;

        (sessionTokens, allOfferingsWithdrawn) =
            houseSessionsController.emergencyWithdrawCurrentSessionTokensFromHouseOffering(
                houseOffering
            );

        houseFundsController.emergencyWithdrawCurrentSessionTokensFromHouseOffering(
            sessionTokens,
            allOfferingsWithdrawn
        );

        // Withdraw from previous session
        if(!HouseOffering(houseOffering).emergencyWithdrawCurrentSessionTokens()) revert();
    }

    // Allows users to withdraw tokens if the contract is in an emergencyPaused state.
    function emergencyWithdraw()
    public
    isEmergencyPaused
    isEmergencyWithdrawalsEnabled {
        uint payout;
        uint amount;

        (payout, amount) = houseFundsController.emergencyWithdraw(msg.sender);

        if(!decentBetToken.transfer(msg.sender, payout)) revert();

        emit LogEmergencyWithdraw(msg.sender, currentSession, amount, payout);
    }

    function getHouseControllers()
    public
    view
    returns (address, address, address) {
        return (
            address(houseAuthorizedController),
            address(houseFundsController),
            address(houseSessionsController)
        );
    }

    // Do not accept ETH sent to this contract.
    function()
    public {
        revert();
    }

}
