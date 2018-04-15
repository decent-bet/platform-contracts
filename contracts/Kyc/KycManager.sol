pragma solidity ^0.4.8;

import '../Libraries/ECVerify.sol';

// KYC manager contract allowing authorized addresses to add/update/remove approved addresses
// Approved addresses can be accessed from House/Gaming contracts
contract KycManager {

    using ECVerify for *;

    // Structs
    struct ApprovedUser {
        address _address;
        string checkId;
        bytes signedMessage;
    }

    // Variables
    address public founder;

    mapping (address => bool) public authorized;
    address[] public authorizedAddressList;

    mapping(address => bool) public approved;
    ApprovedUser[] public approvedAddressList;

    // Events
    event LogNewAuthorizedAddress   (address _address);
    event LogRemoveAuthorizedAddress(address _address);
    event LogNewApprovedAddress     (address _address);
    event LogRemoveApprovedAddress  (address _address);

    function KycManager() {
        founder = msg.sender;
    }

    // Allows only founder to execute a function
    modifier onlyFounder() {
        assert(msg.sender == founder);
        _;
    }

    // Allows only authorized addresses to execute a function
    modifier onlyAuthorized() {
        assert(authorized[msg.sender] == true);
        _;
    }

    // Adds an authorized address
    function addAuthorizedAddress(address _address)
    onlyFounder {
        assert(authorized[_address] == false);
        authorized[_address] = true;
        authorizedAddressList.push(_address);
        LogNewAuthorizedAddress(_address);
    }

    // Removes an authorized address
    function removeAuthorizedAddress(address _address, uint index)
    onlyFounder {
        assert(authorized[_address] == true);
        assert(authorizedAddressList[index] == _address);
        authorized[_address] = false;
        delete authorizedAddressList[index];
        LogRemoveAuthorizedAddress(_address);
    }

    // Approves a user address after KYC checks from onfido backend
    // checkId would be the checkId for a successful verification from the onfido backend
    // Signed message would be of the format sgn(sha3(checkId))
    function approveAddress(address _address, string checkId, bytes signedMessage)
    onlyAuthorized {
        assert(approved[_address] == false);
        bytes32 hash = keccak256(_address, checkId);
        if(!ECVerify.ecverify(hash, signedMessage, _address)) revert();
        approved[_address] = true;
        approvedAddressList.push(ApprovedUser({
            _address:      _address,
            checkId:       checkId,
            signedMessage: signedMessage
        }));
        LogNewApprovedAddress(_address);
    }

    // Removes an address from the KYC approved list
    function removeApprovedAddress(address _address, uint index)
    onlyAuthorized {
        assert(approved[_address] == true);
        assert(approvedAddressList[index]._address == _address);

        approved[_address] = false;
        delete approvedAddressList[index];
        LogRemoveApprovedAddress(_address);
    }

    // Returns whether an address has been verified
    function isVerified(address _address) returns (bool) {
        return approved[_address];
    }

}
