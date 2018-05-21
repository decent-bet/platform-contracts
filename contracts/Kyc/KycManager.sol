pragma solidity 0.4.21;

// KYC manager contract allowing authorized addresses to add/update/remove approved addresses
// Approved addresses can be accessed from House/Gaming contracts
contract KycManager {

    // Structs
    struct Approval {
        bool approved;
        uint index;
        // Basic verification
        string id;
        // Enhanced verification
        string applicantId;
        string checkId;
        bool exists;
    }

    // Variables
    address public founder;

    mapping (address => bool) public authorized;
    address[] public authorizedAddressList;

    mapping (address => Approval) public approvals;
    address[] public approvedAddressList;

    // Blacklist mapping
    mapping (address => bool) public blacklist;

    // Maps address to last timeout timestamp.
    // Withdrawals would not be allowed up to 24 hrs after the last timeout timestamp
    mapping (address => uint) public timeoutBlacklist;

    // Non enhanced KYC DBETs limit
    uint public dbetsNonEnhancedKycLimit;

    // Events
    event LogNewAuthorizedAddress               (address _address);
    event LogRemoveAuthorizedAddress            (address _address);
    event LogNewApprovedAddress                 (address _address, uint index);
    event LogApprovedAddressWithEnhancedKYC     (address _address);
    event LogRemoveApprovedAddress              (address _address);

    event LogAddToBlacklist                     (address _address);
    event LogRemoveFromBlacklist                (address _address);
    event LogAddToTimeoutBlacklist              (address _address, uint timestamp);
    event LogUpdateDbetsNonEnhancedKycLimit     (address sender, uint timestamp);

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
        emit LogNewAuthorizedAddress(_address);
    }

    // Removes an authorized address
    function removeAuthorizedAddress(address _address, uint index)
    onlyFounder {
        require(authorized[_address]);
        require(authorizedAddressList[index] == _address);
        authorized[_address] = false;
        delete authorizedAddressList[index];
        emit LogRemoveAuthorizedAddress(_address);
    }

    // Approves an address for basic verification
    // Addresses with basic verification are subject to < 2 BTC/day withdrawal limits
    // Signed message would be of the format sgn(sha3(uid)) where approvalId is an
    // id returned from decent.bet's KYC api during the initial verification process
    function approveAddress(
        address _address,
        string approvalId,
        uint8 v,
        bytes32 r,
        bytes32 s
    )
    onlyAuthorized {
        require(!approvals[_address].approved);
        bytes32 hash = keccak256(approvalId);
        require(_address == ecrecover(hash, v, r, s));
        approvals[_address].approved = true;
        approvals[_address].exists = true;
        approvals[_address].id = approvalId;
        approvals[_address].index = approvedAddressList.length;
        approvedAddressList.push(_address);
        emit LogNewApprovedAddress(_address, approvedAddressList.length - 1);
    }

    // Approves a user address after KYC checks from Onfido backend for enhanced verification
    // This can only be called after basic verification has been performed.
    // Addresses with enhanced verification are not subject to any withdrawal limits
    // applicantId would be the applicantId created by Onfido
    // checkId would be the checkId for a successful verification from the Onfido backend
    // Signed message would be of the format sgn(sha3(checkId))
    function approveAddressWithEnhancedKYC(
        address _address,
        string applicantId,
        string checkId,
        uint8 v,
        bytes32 r,
        bytes32 s
    )
    onlyAuthorized {
        require(approvals[_address].approved);
        // Applicant ID could be changed in case of cases such as user account deletion in KYC and re-creation
        // require(approvals[_address].applicantId != '');
        bytes32 hash = keccak256(applicantId);
        require(_address == ecrecover(hash, v, r, s));
        approvals[_address].applicantId = applicantId;
        approvals[_address].checkId = checkId;
        emit LogApprovedAddressWithEnhancedKYC(_address);
    }

    // Removes an address from the KYC approved list
    function removeApprovedAddress(address _address)
    onlyAuthorized {
        require(approvals[_address].approved);
        delete approvedAddressList[approvals[_address].index];
        approvals[_address].approved = false;
        approvals[_address].index = 0;
        approvals[_address].id = "";
        approvals[_address].applicantId = "";
        approvals[_address].checkId = "";
        approvals[_address].exists = false;
        emit LogRemoveApprovedAddress(_address);
    }

    // Adds an address to blacklist
    function addToBlacklist(address _address)
    onlyAuthorized {
        require(!blacklist[_address]);
        blacklist[_address] = true;
        emit LogAddToBlacklist(_address);
    }

    // Removes an address from blacklist
    function removeFromBlacklist(address _address)
    onlyAuthorized {
        require(blacklist[_address]);
        blacklist[_address] = false;
        emit LogRemoveFromBlacklist(_address);
    }

    // Adds an address to a timeout blacklist.
    // If timeoutBlacklist timestamp is less than 24 hr prior to the current block timestamp,
    // Further withdrawals would not be allowed from house/offering contracts.
    function addToTimeoutBlacklist(address _address)
    onlyAuthorized {
        require(!isEnhancedKYCVerified(_address));
        timeoutBlacklist[_address] = block.timestamp;
        emit LogAddToTimeoutBlacklist(_address, block.timestamp);
    }

    // Update DBETs non-enhanced KYC limit
    function updateDbetsNonEnhancedKycLimit(uint _dbetsNonEnhancedKycLimit)
    onlyAuthorized {
        dbetsNonEnhancedKycLimit = _dbetsNonEnhancedKycLimit;
        LogUpdateDbetsNonEnhancedKycLimit(msg.sender, block.timestamp);
    }

    // Returns whether an address has been verified with
    // atleast basic verification and is not blacklisted
    function isKYCVerified(address _address) view returns (bool) {
    return  !blacklist[_address] &&
            approvals[_address].exists &&
            approvals[_address].approved;
    }

    // Returns whether an address has been verified with
    // enhanced verification and is not blacklisted
    function isEnhancedKYCVerified(address _address) view returns (bool) {
        return  !blacklist[_address] &&
                isKYCVerified(_address) &&
                bytes(approvals[_address].applicantId).length > 0;
    }

    // Returns whether an address can withdraw from a house/offering contract
    function areWithdrawalsAllowed(address _address) view returns (bool) {
        return (
                    !blacklist[_address] &&
                    (
                        isEnhancedKYCVerified(_address) ||
                        (
                            isKYCVerified(_address) &&
                            (block.timestamp > timeoutBlacklist[_address] + 24 hours)
                        )
                    )
               );
    }

    // Returns whether a single withdrawal is allowed
    function isWithdrawalAllowed(address _address, uint amount) view returns (bool) {
        return
            (   areWithdrawalsAllowed(_address) &&
                (
                    isEnhancedKYCVerified(_address) ||
                    amount <= dbetsNonEnhancedKycLimit
                )
            );
    }

}
