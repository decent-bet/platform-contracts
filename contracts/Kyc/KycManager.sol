pragma solidity ^0.4.8;

// KYC manager contract allowing authorized addresses to add/update/remove approved addresses
// Approved addresses can be accessed from House/Gaming contracts
contract KycManager {

    // Structs
    struct User {
        address _address;
        bool approved;
        string applicantId;
        string checkId;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct KycEnabledContract {
        // User mapping
        mapping (address => User) users;
        // List of approved users for contract
        address[] approvedAddressList;
        // Exists
        bool exists;
    }

    // Variables
    address public founder;

    mapping (address => bool) public authorized;
    address[] public authorizedAddressList;

    mapping(address => KycEnabledContract) public kycEnabledContracts;
    address[] public kycEnabledContractList;

    // Events
    event LogNewKycEnabledContract    (address _address, address authorized);
    event LogRemovedKycEnabledContract(address _address, address authorized);

    event LogNewAuthorizedAddress     (address _address);
    event LogRemoveAuthorizedAddress  (address _address);

    event LogNewApprovedAddress       (address _contract, address _address, uint index);
    event LogRemoveApprovedAddress    (address _contract, address _address);

    function KycManager()
    public {
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

    // Allows function to execute only if passed address is of a contract
    modifier isContract(address _address) {
        uint size;
        assembly { size := extcodesize(_address) }
        require(size > 0);
        _;
    }

    // Allows authorized addresses to add a KYC enabled contract
    function addKycEnabledContract(address _address)
    isContract(_address)
    onlyAuthorized
    public {
        require(!kycEnabledContracts[_address].exists);
        kycEnabledContractList.push(_address);
        kycEnabledContracts[_address].exists = true;
        emit LogNewKycEnabledContract(_address, msg.sender);
    }

    // Allows authorized addresses to remove a KYC enabled contract
    function removeKycEnabledContract(address _address, uint index)
    onlyAuthorized
    public {
        require(kycEnabledContracts[_address].exists);
        require(kycEnabledContractList[index] == _address);
        delete kycEnabledContractList[index];
        kycEnabledContracts[_address].exists = false;
        emit LogRemovedKycEnabledContract(_address, msg.sender);
    }

    // Adds an authorized address
    function addAuthorizedAddress(address _address)
    onlyFounder
    public {
        require(!authorized[_address]);
        authorized[_address] = true;
        authorizedAddressList.push(_address);
        emit LogNewAuthorizedAddress(_address);
    }

    // Removes an authorized address
    function removeAuthorizedAddress(address _address, uint index)
    onlyFounder
    public {
        require(authorized[_address]);
        require(authorizedAddressList[index] == _address);
        authorized[_address] = false;
        delete authorizedAddressList[index];
        emit LogRemoveAuthorizedAddress(_address);
    }

    // Approves a user address after KYC checks from onfido backend
    // checkId would be the checkId for a successful verification from the onfido backend
    // Signed message would be of the format sgn(sha3(applicantId))
    function approveAddress(address _contract, address _address, string applicantId,
        string checkId, uint8 v, bytes32 r, bytes32 s)
    onlyAuthorized
    public {
        require(kycEnabledContracts[_contract].exists);
        require(!kycEnabledContracts[_contract].users[_address].approved);
        bytes32 hash = keccak256(applicantId);
        require(_address == ecrecover(hash, v, r, s));
        kycEnabledContracts[_contract].users[_address] = User({
            _address:      _address,
            approved:      true,
            applicantId:   applicantId,
            checkId:       checkId,
            v:             v,
            r:             r,
            s:             s
        });
        kycEnabledContracts[_contract].approvedAddressList.push(_address);
        emit LogNewApprovedAddress(_contract, _address, kycEnabledContracts[_contract].approvedAddressList.length - 1);
    }

    // Removes an address from the KYC approved list
    function removeApprovedAddress(address _contract, address _address, uint index)
    onlyAuthorized
    public {
        require(kycEnabledContracts[_contract].exists);
        require(kycEnabledContracts[_contract].users[_address].approved);
        require(kycEnabledContracts[_contract].approvedAddressList[index] == _address);

        kycEnabledContracts[_contract].users[_address].approved = false;
        delete kycEnabledContracts[_contract].approvedAddressList[index];
        emit LogRemoveApprovedAddress(_contract, _address);
    }

    // Returns whether an address has been verified for a contract.
    // Works even if KYC enabled contract has been removed from this contract.
    function isVerified(address _contract, address _address)
    public
    view
    returns (bool) {
        return kycEnabledContracts[_contract].users[_address].approved;
    }

    // Returns a KYC enabled contract user.
    function getKYCEnabledContractUser(address _contract, address _address)
    public
    view
    returns (bool, string, string, uint8, bytes32, bytes32) {
        return (kycEnabledContracts[_contract].users[_address].approved,
                kycEnabledContracts[_contract].users[_address].applicantId,
                kycEnabledContracts[_contract].users[_address].checkId,
                kycEnabledContracts[_contract].users[_address].v,
                kycEnabledContracts[_contract].users[_address].r,
                kycEnabledContracts[_contract].users[_address].s);
    }

}
