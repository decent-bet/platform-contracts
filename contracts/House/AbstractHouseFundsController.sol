pragma solidity ^0.4.0;

contract AbstractHouseFundsController {

    function isHouseFundsController() returns (bool) {}
    function purchaseCredits(address _address, uint amount) returns (uint) {}
    function liquidateCredits(address _address, uint session) returns (uint, uint) {}
    function rollOverCredits(address _address, uint amount) returns (bool) {}
    function claimRolledOverCredits(address _address) returns (uint, uint, uint) {}
    function addToSessionProfitsFromUnregisteredHouseOffering(address, uint, uint) returns (bool) {}
    function withdrawPreviousSessionTokensFromHouseOffering(address, uint, bool) returns (bool) {}
    function getPayoutPerCredit(uint session) returns (uint) {}
    function houseFunds(uint session) returns (uint, uint, uint, uint, uint, uint, uint) {}

}
