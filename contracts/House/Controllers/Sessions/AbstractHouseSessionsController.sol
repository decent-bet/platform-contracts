pragma solidity ^0.4.0;

contract AbstractHouseSessionsController {

    function isHouseSessionsController() returns (bool) {}
    function offeringAddresses(uint index) returns (address) {}
    function getOfferingAddressesLength() returns (uint) {}
    function sessions(uint) returns (uint, uint, bool, uint, uint, uint) {}
    function getSessionOffering(uint, uint) returns (address) {}
    function getSessionOfferingsLength(uint) returns (uint) {}
    function getSessionTimes(uint) returns (uint, uint) {}
    function getOfferingTokenAllocations(uint, address) returns (uint, uint) {}
    function isOfferingWithdrawn(uint, address) returns (bool) {}
    function isSessionActive(uint) returns (bool) {}

    function addHouseOffering(address _address) returns (bool) {}
    function removeOfferingFromNextSession(address _address) returns (bool) {}
    function withdrawPreviousSessionTokensFromHouseOffering(address _address) returns (uint, bool) {}
    function allocateTokensForHouseOffering(uint, address) returns (bool) {}
    function depositAllocatedTokensToHouseOffering(address) returns (bool) {}
    function emergencyWithdrawCurrentSessionTokensFromHouseOffering(address) returns (uint, bool) {}
    function beginNextSession(uint, uint, uint) returns (bool) {}
}
