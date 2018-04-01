pragma solidity ^0.4.0;

contract AbstractHouseFundsController {

    /*
     * CALL FUNCTIONS
     */
    // Returns whether the contract is a house funds controller contract.
    function isHouseFundsController() returns (bool isHouseFundsController) {}
    // Returns the payout per credit for a session.
    function getPayoutPerCredit(uint session) returns (uint payoutPerCredit) {}
    // Returns house fund information for a session.
    function houseFunds(uint session) returns (uint totalFunds, uint totalPurchasedUserCredits, uint totalUserCredits,
                                               uint totalHousePayouts, uint totalWithdrawn,
                                               uint totalUnregisteredOfferingProfits, uint profit) {}

    /*
     * STATE CHANGING FUNCTIONS
     */
    // Purchases credits for a session. Returns amount of credits for the session after purchase.
    function purchaseCredits(address _address, uint amount) returns (uint userCredits) {}
    // Liquidates credits for a session. Returns the payout along with the amount of credits prior to liquidation.
    function liquidateCredits(address _address, uint session) returns (uint payout, uint amount) {}
    // Rolls over credits to the next session.
    function rollOverCredits(address _address, uint amount) returns (bool rolledOver) {}
    // Claims rolled over credits from previous session. Returns the adjusted credits based on the payout per credit from the previous session,
    // the amount of credits rolled over from the previous session and updated user credits amount after the claim.
    function claimRolledOverCredits(address _address) returns (uint adjustedCredits, uint rolledOverFromPreviousSession, uint userCredits) {}
    // Adds session profits from unregistered house offerings.
    function addToSessionProfitsFromUnregisteredHouseOffering(address offering, uint session, uint amount) returns (bool added) {}
    // Withdraws previous session tokens from a house offering.
    function withdrawPreviousSessionTokensFromHouseOffering(address, uint, bool) returns (bool withdrawn) {}
    // Withdraws current session tokens from an offering if the contract is in an emergency paused state.
    function emergencyWithdrawCurrentSessionTokensFromHouseOffering(address, uint, bool) returns (bool withdrawn) {}
    // Allows users to emergency withdraw if emergency withdrawals are enabled and contract is in a paused state.
    function emergencyWithdraw(address _address) returns (uint payout, uint amount) {}

}
