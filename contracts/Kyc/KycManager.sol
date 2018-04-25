pragma solidity ^0.4.8;

// KYC manager contract allowing authorized addresses to add/update/remove approved addresses
// Approved addresses can be accessed from House/Gaming contracts
contract KycManager {

    // Structs
    struct ApprovedUser {
        address _address;
        string checkId;
        uint8 v;
        bytes32 r;
        bytes32 s;
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
    event LogNewApprovedAddress     (address _address, uint index);
    event LogRemoveApprovedAddress  (address _address);

    function KycManager() {
        founder = msg.sender;
        addAuthorizedAddress(msg.sender);
    }

    // Allows only founder to execute a function
    modifier onlyFounder() {
        require(msg.sender == founder);
        _;
    }

    // Allows only authorized addresses to execute a function
    modifier onlyAuthorized() {
        require(authorized[msg.sender]);
        _;
    }

    // Adds an authorized address
    function addAuthorizedAddress(address _address)
    onlyFounder {
        require(!authorized[_address]);
        authorized[_address] = true;
        authorizedAddressList.push(_address);
        LogNewAuthorizedAddress(_address);
    }

    // Removes an authorized address
    function removeAuthorizedAddress(address _address, uint index)
    onlyFounder {
        require(authorized[_address]);
        require(authorizedAddressList[index] == _address);
        authorized[_address] = false;
        delete authorizedAddressList[index];
        LogRemoveAuthorizedAddress(_address);
    }

    function checkSig(address _address, string checkId, uint8 v, bytes32 r, bytes32 s) constant returns (bytes32, address) {
        bytes32 hash = keccak256(checkId);
        return (hash, ecrecover(hash, v, r, s));
    }

    // Approves a user address after KYC checks from onfido backend
    // checkId would be the checkId for a successful verification from the onfido backend
    // Signed message would be of the format sgn(sha3(checkId))
    function approveAddress(address _address, string checkId, uint8 v, bytes32 r, bytes32 s)
    onlyAuthorized {
        require(!approved[_address]);
        bytes32 hash = keccak256(checkId);
        require(_address == ecrecover(hash, v, r, s));
        approved[_address] = true;
        approvedAddressList.push(ApprovedUser({
            _address:      _address,
            checkId:       checkId,
            v:             v,
            r:             r,
            s:             s
        }));
        LogNewApprovedAddress(_address, approvedAddressList.length - 1);
    }

    // Removes an address from the KYC approved list
    function removeApprovedAddress(address _address, uint index)
    onlyAuthorized {
        require(approved[_address]);
        require(approvedAddressList[index]._address == _address);

        approved[_address] = false;
        delete approvedAddressList[index];
        LogRemoveApprovedAddress(_address);
    }

    // Returns whether an address has been verified
    function isVerified(address _address) constant returns (bool) {
        return approved[_address];
    }

}
