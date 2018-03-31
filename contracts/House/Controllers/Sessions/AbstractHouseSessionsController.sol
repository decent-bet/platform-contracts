pragma solidity ^0.4.0;

contract AbstractHouseSessionsController {

    /*
     * CALL FUNCTIONS
     */
    // Returns whether the contract is a house session controller
    function isHouseSessionsController() returns (bool isHouseSessionsController) {}
    // Access the offering addresses array
    function offeringAddresses(uint index) returns (address offering) {}
    // Returns the length of the offering addresses array
    function getOfferingAddressesLength() returns (uint length) {}
    // Returns session info
    function sessions(uint session) returns (uint startTime, uint endTime, bool active, uint withdrawCount,
                                             uint totalTokensAllocated, uint depositedAllocations) {}
    // Returns the address for a session offering at an array index
    function getSessionOffering(uint session, uint index) returns (address offeringAddress) {}
    // Returns the number of offerings for a session
    function getSessionOfferingsLength(uint session) returns (uint length) {}
    // Returns session start and end times
    function getSessionTimes(uint session) returns (uint startTime, uint endTime) {}
    // Returns the token allocation and deposit for an offering for a session
    function getOfferingTokenAllocations(uint session, address offering) returns (uint allocation, uint deposited) {}

    /*
     * STATE CHANGING FUNCTIONS
     */
    // Returns whether a session offering tokens were withdrawn
    function isOfferingWithdrawn(uint session, address offering) returns (bool withdrawn) {}
    // Returns whether a session is active
    function isSessionActive(uint session) returns (bool active) {}
    // Adds a house offering to the next session
    function addHouseOffering(address _address) returns (bool added) {}
    // Removes an offering from the next session
    function removeOfferingFromNextSession(address _address) returns (bool removed) {}
    // Withdraws previous session tokens from a house offering
    function withdrawPreviousSessionTokensFromHouseOffering(address _address) returns (uint session, bool withdrawn) {}
    // Allocates tokens for a house offering
    function allocateTokensForHouseOffering(uint session, address offering) returns (bool allocated) {}
    // Deposits allocated tokens to a house offering
    function depositAllocatedTokensToHouseOffering(address offering) returns (bool deposited) {}
    // Withdraws current session tokens from an offering if the contract is in an emergency paused state
    function emergencyWithdrawCurrentSessionTokensFromHouseOffering(address offering)
             returns (uint sessionTokens, bool allOfferingsWithdrawn) {}
    // Begins the next house session
    function beginNextSession(uint startTime, uint endTime, uint sessionZeroStartTime) returns (bool startedNextSession) {}

}
