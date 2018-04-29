pragma solidity ^0.4.19;

import '../HouseOffering.sol';

import '../House.sol';
import '../../Token/ERC20.sol';
import '../../Libraries/SafeMath.sol';

// All functionality related to house sessions and offerings reside here.
// House sessions records are saved here to decouple the record keeping from the House contract to reduce gas costs on deployment.
contract HouseSessionsController is SafeMath {

    // Structs
    struct Session {
        uint startTime;
        uint endTime;
        bool active;
        // Offerings available for this session.
        address[] offerings;
        // Offerings that have been withdrawn from in this session.
        // All offerings must be withdrawn to switch to the next session.
        mapping (address => bool) withdrawnOfferings;
        uint withdrawCount;
        // %age allocation of total tokens for deposit at start of session.
        mapping (address => TokenAllocations) offeringTokenAllocations;
        // Total % of tokens allocated, must be equal before switching to next session.
        uint totalTokensAllocated;
        // Increments by 1 after each deposit to an offering allocation.
        uint depositedAllocations;
    }

    struct TokenAllocations {
        // Amount allocated to offering.
        uint allocation;
        bool deposited;
    }

    struct Offering {
        HouseOffering houseOffering;
        bool exists;
    }

    // Variables
    House house;
    ERC20 public decentBetToken;
    address[] public offeringAddresses;

    bool public isHouseSessionsController = true;

    // Mappings
    // House offerings available for house.
    mapping (address => Offering) offerings;

    // Session statistics.
    mapping (uint => Session) public sessions;

    function HouseSessionsController(address _house) public {
        require(_house != 0x0);
        house = House(_house);
        decentBetToken = ERC20(house.decentBetToken());
    }

    // Modifiers
    // Allows functions to execute only if the house contract sent the transaction.
    modifier onlyHouse() {
        require(msg.sender == address(house));
        _;
    }

    modifier onlyFounder() {
        require(msg.sender == house.founder());
        _;
    }

    // Allows functions to execute only if the house offering exists.
    modifier isValidHouseOffering(address offering) {
        require(offerings[offering].exists);
        _;
    }

    // Adds a new offering to the house.
    function addHouseOffering(address houseOfferingAddress)
    onlyFounder
    public {
        // Empty address, invalid input
        require(houseOfferingAddress != 0x0);
        // Not a house offering
        require(HouseOffering(houseOfferingAddress).isHouseOffering());

        offeringAddresses.push(houseOfferingAddress);
        offerings[houseOfferingAddress] = Offering({
            houseOffering: HouseOffering(houseOfferingAddress),
            exists: true
            });
        addOfferingToNextSession(houseOfferingAddress);
    }

    // Adds a house offering to the next session
    function addOfferingToNextSession(address houseOfferingAddress)
    isValidHouseOffering(houseOfferingAddress)
    onlyFounder
    internal {
        uint nextSession = house.currentSession() + 1;
        sessions[nextSession].offerings.push(houseOfferingAddress);
    }

    // Remove an offering from the next session
    function removeOfferingFromNextSession(address houseOfferingAddress)
    isValidHouseOffering(houseOfferingAddress)
    onlyFounder
    public {
        // TODO: Look into support for current session - freeze contract, allow token withdrawals etc.
        uint nextSession = house.currentSession() + 1;
        for(uint i = 0; i < sessions[nextSession].offerings.length; i++) {
            if(sessions[nextSession].offerings[i] == houseOfferingAddress)
                delete sessions[nextSession].offerings[i];
        }
        offerings[houseOfferingAddress].exists = false;
    }

    // Withdraws session tokens for the previously ended session from a house offering.
    function withdrawPreviousSessionTokensFromHouseOffering(address houseOffering)
    isValidHouseOffering(houseOffering)
    onlyHouse
    public
    returns (uint, bool) {
        uint currentSession = house.currentSession();
        uint previousSession = currentSession - 1;
        // Withdrawals are only allowed after session 1.
        require(currentSession > 1);

        // Tokens can only be withdrawn from offerings by house 48h after the previous session has ended to account
        // for pending bets/game outcomes.
        require(house.getTime() >= (sessions[previousSession].endTime + 2 days));

        // Allow only if offering has not been withdrawn.
        require(!sessions[previousSession].withdrawnOfferings[houseOffering]);

        uint previousSessionTokens = offerings[houseOffering].houseOffering.balanceOf(houseOffering, previousSession);

        sessions[previousSession].withdrawnOfferings[houseOffering] = true;
        sessions[previousSession].withdrawCount += 1;

        // All offerings have been withdrawn.
        bool allOfferingsWithdrawn =
        sessions[previousSession].withdrawCount == sessions[previousSession].offerings.length;

        return (previousSessionTokens, allOfferingsWithdrawn);
    }

    // Allocates a %age of tokens for a house offering for the next session
    function allocateTokensForHouseOffering(uint percentage, address houseOffering)
    isValidHouseOffering(houseOffering)
    onlyHouse
    public
    returns (bool) {
        uint nextSession = house.currentSession() + 1;

        // Total %age of tokens can't be above 100.
        require(safeAdd(sessions[nextSession].totalTokensAllocated, percentage) <= 100);

        // Tokens have already been deposited to offering.
        require(!sessions[nextSession].offeringTokenAllocations[houseOffering].deposited);

        uint previousAllocation = sessions[nextSession].offeringTokenAllocations[houseOffering].allocation;

        sessions[nextSession].offeringTokenAllocations[houseOffering].allocation = percentage;
        sessions[nextSession].totalTokensAllocated =
        safeSub(safeAdd(sessions[nextSession].totalTokensAllocated, percentage), previousAllocation);

        return true;
    }

    function depositAllocatedTokensToHouseOffering(address houseOffering)
    isValidHouseOffering(houseOffering)
    onlyHouse
    public
    returns (bool) {
        uint nextSession = house.currentSession() + 1;

        // Tokens have already been deposited to offering.
        require(!sessions[nextSession].offeringTokenAllocations[houseOffering].deposited);

        sessions[nextSession].offeringTokenAllocations[houseOffering].deposited = true;
        sessions[nextSession].depositedAllocations = safeAdd(sessions[nextSession].depositedAllocations, 1);

        return true;
    }

    function emergencyWithdrawCurrentSessionTokensFromHouseOffering(address houseOffering)
    isValidHouseOffering(houseOffering)
    onlyHouse
    public
    returns (uint, bool) {
        uint currentSession = house.currentSession();
        uint sessionTokens = offerings[houseOffering].houseOffering.balanceOf(houseOffering, currentSession);

        sessions[currentSession].withdrawnOfferings[houseOffering] = true;
        sessions[currentSession].withdrawCount += 1;

        // All offerings have been withdrawn.
        bool allOfferingsWithdrawn =
        sessions[currentSession].withdrawCount == sessions[currentSession].offerings.length;

        return (sessionTokens, allOfferingsWithdrawn);
    }

    // Starts the next session.
    // Call this function once after setting up the house to begin the initial credit buying period.
    function beginNextSession(uint startTime, uint endTime, uint sessionZeroStartTime)
    onlyHouse
    public
    returns (bool) {
        uint currentSession = house.currentSession();

        if (currentSession == 0 && sessionZeroStartTime == 0) {
            sessions[currentSession].active = false;
            sessions[currentSession].startTime = startTime;
            sessions[currentSession].endTime = endTime;
        } else {
            uint previousSession = currentSession - 1;
            // currentSession has been set to nextSession in House contract.
            sessions[previousSession].active = false;

            // For a session to be considered active, getTime() would need to be between startTime and endTime
            // AND session should be active.
            sessions[currentSession].active = true;
            sessions[currentSession].startTime = startTime;
            sessions[currentSession].endTime = endTime;

            // All offerings should have allocated tokens deposited before switching to next session.
            require(sessions[currentSession].depositedAllocations == sessions[currentSession].offerings.length);
        }

        return true;
    }

    // Utility functions for front-end purposes.

    // Returns session start and end time.
    function getSessionTime(uint session) public constant returns (uint, uint) {
        return (sessions[session].startTime, sessions[session].endTime);
    }

    // Returns whether a session is active.
    function isSessionActive(uint session) public constant returns (bool) {
        return house.getTime() >= sessions[session].startTime &&
               house.getTime() <= sessions[session].endTime;
    }

    // Returns whether an offering exists.
    function doesOfferingExist(address _offering) public constant returns (bool) {
        return offerings[_offering].exists;
    }

    // Returns an offering for a session.
    function getSessionOffering(uint session, uint index) public constant returns (address offering) {
        return sessions[session].offerings[index];
    }

    function getSessionTimes(uint session) public constant returns (uint, uint) {
        return (sessions[session].startTime, sessions[session].endTime);
    }

    // Returns offering token allocations and deposits.
    function getOfferingTokenAllocations(uint session, address _address) public constant returns (uint, bool) {
        return (sessions[session].offeringTokenAllocations[_address].allocation,
        sessions[session].offeringTokenAllocations[_address].deposited);
    }

    function getSessionOfferingsLength(uint session) public constant returns (uint) {
        return sessions[session].offerings.length;
    }

    function getOfferingAddressesLength() public constant returns (uint) {
        return offeringAddresses.length;
    }

    function isOfferingWithdrawn(uint session, address offering) public view returns (bool) {
        return sessions[session].withdrawnOfferings[offering];
    }

}
