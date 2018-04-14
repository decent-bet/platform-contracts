pragma solidity ^0.4.8;

import '../Libraries/ECVerify.sol';

// KYC manager contract allowing authorized addresses to add/update/remove approved addresses
// Approved addresses can be accessed from House/Gaming contracts
contract KycManager is ECVerify {

    // Structs
    struct ApprovedUser {
        address _address;
        string checkId;
        bytes signedMessage;
    }

    // Variables
    address public owner;

    mapping (address => bool) public authorizedAddresses;
    address[] public authorizedAddressList;

    mapping(address => bool) public approvedAddresses;
    ApprovedUser[] public approvedAddressList;

    // Events
    event LogNewAuthorizedAddress   (address _address);
    event LogRemoveAuthorizedAddress(address _address);
    event LogNewApprovedAddress     (address _address);
    event LogRemoveApprovedAddress  (address _address);

    function KycManager() {
        owner = msg.sender;
    }

    // Allows only owners to execute a function
    modifier onlyOwner() {
        assert(msg.sender == owner);
        _;
    }

    // Allows only authorized addresses to execute a function
    modifier onlyAuthorized() {
        assert(authorizedAddresses[msg.sender] == true);
        _;
    }

    // Adds an authorized address
    function addAuthorizedAddress(address _address)
    onlyOwner {
        assert(authorizedAddresses[_address] == false);
        authorizedAddresses[_address] = true;
        authorizedAddressList.push(_address);
        LogNewAuthorizedAddress(_address);
    }

    // Removes an authorized address
    function removeAuthorizedAddress(address _address, uint index)
    onlyOwner {
        assert(authorizedAddresses[_address] == true);
        assert(authorizedAddressList[index] == _address);
        authorizedAddresses[_address] = false;
        delete authorizedAddresses[index];
        LogRemoveAuthorizedAddress(_address);
    }

    // Approves a user address after KYC checks from onfido backend
    // checkId would be the checkId for a successful verification from the onfido backend
    // Signed message would be of the format sgn(sha3(checkId))
    function approveAddress(address _address, string checkId, bytes signedMessage)
    onlyAuthorized {
        assert(approvedAddresses[_address] == false);
        bytes32 hash = keccak256(_address, checkId);
        if(!ecverify(hash, signedMessage, _address)) revert();
        approvedAddresses[_address] = true;
        ApprovedUser user = ApprovedUser({
            _address:      _address,
            checkId:       checkId,
            signedMessage: signedMessage
        });
        approvedAddressList.push(user);
        LogNewApprovedAddress(_address);
    }

    // Removes an address from the KYC approved list
    function removeApprovedAddress(address _address, uint index)
    onlyAuthorized {
        assert(approvedAddresses[_address] == true);
        assert(approvedAddressList[index]._address == _address);

        approvedAddresses[_address] = false;
        delete approvedAddressList[index];
        LogRemoveApprovedAddress(_address);
    }

    // Returns whether an address has been verified
    function isVerified(address _address) returns (bool) {
        return approvedAddresses[_address];
    }

}
