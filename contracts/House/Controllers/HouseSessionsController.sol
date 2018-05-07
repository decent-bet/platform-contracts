pragma solidity 0.4.21;

import "../HouseOffering.sol";

import "../House.sol";
import "../../Token/ERC20.sol";
import "../../Libraries/SafeMath.sol";

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
        // Number of offerings available
        uint offeringCount;
        // Offerings that have been withdrawn from in this session.
        // All offerings must be withdrawn to switch to the next session.
        mapping (address => bool) withdrawnOfferings;
        uint withdrawCount;
        // Details for an offering for a session.
        mapping (address => OfferingDetails) offeringDetails;
        // Total % of tokens allocated, must be equal before switching to next session.
        uint totalTokensAllocated;
        // Have the token allocations been finalized? (Possible only if all offerings have been
        // allocated tokens and totalTokensAllocated == 100)
        bool finalizedTokenAllocations;
        // Increments by 1 after each deposit to an offering allocation.
        uint depositedAllocations;
    }

    struct OfferingDetails {
        // Amount allocated to offering.
        uint allocation;
        // True if tokens have been deposited to offering.
        bool deposited;
        // True if offering has been added to session.
        bool addedToSession;
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

    function HouseSessionsController(address _house)
    public {
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
    modifier isValidHouseOffering(address offering, uint session) {
        require(offerings[offering].exists);
        require(sessions[session].offeringDetails[offering].addedToSession);
        _;
    }

    // Adds a new offering to the house.
    function addHouseOffering(address houseOfferingAddress)
    public
    onlyFounder {
        // Valid address
        require(houseOfferingAddress != 0x0);
        // Is a house offering
        require(HouseOffering(houseOfferingAddress).isHouseOffering());
        // Should not already be added
        require(!offerings[houseOfferingAddress].exists);
        offeringAddresses.push(houseOfferingAddress);

        offerings[houseOfferingAddress] = Offering({
            houseOffering: HouseOffering(houseOfferingAddress),
            exists: true
        });
        addOfferingToNextSession(houseOfferingAddress);
    }

    // Adds a house offering to the next session
    function addOfferingToNextSession(address houseOfferingAddress)
    public
    onlyFounder {
        require(offerings[houseOfferingAddress].exists);
        require(!sessions[nextSession].offeringDetails[houseOfferingAddress].addedToSession);
        uint nextSession = house.currentSession() + 1;
        sessions[nextSession].offerings.push(houseOfferingAddress);
        sessions[nextSession].offeringCount = safeAdd(sessions[nextSession].offeringCount, 1);
        sessions[nextSession].offeringDetails[houseOfferingAddress].addedToSession = true;
    }

    // Remove an offering from the next session
    function removeOfferingFromNextSession(address houseOfferingAddress)
    public
    isValidHouseOffering(
        houseOfferingAddress,
        safeAdd(house.currentSession(), 1)
    )
    onlyFounder {
        // TODO: Look into support for current session - freeze contract, allow token withdrawals etc.
        uint nextSession = safeAdd(house.currentSession(), 1);
        for(uint i = 0; i < sessions[nextSession].offerings.length; i++) {
            if(sessions[nextSession].offerings[i] == houseOfferingAddress)
                delete sessions[nextSession].offerings[i];
        }
        sessions[nextSession].offeringCount =
            safeSub(sessions[nextSession].offeringCount, 1);
        sessions[nextSession].offeringDetails[houseOfferingAddress].addedToSession =
            false;
        offerings[houseOfferingAddress].exists = false;
    }

    // Withdraws session tokens for the previously ended session from a house offering.
    function withdrawPreviousSessionTokensFromHouseOffering(address houseOffering)
    public
    isValidHouseOffering(houseOffering, safeSub(house.currentSession(), 1))
    onlyHouse
    returns (uint, bool) {
        uint currentSession = house.currentSession();
        uint previousSession = safeSub(currentSession, 1);
        // Withdrawals are only allowed after session 1.
        require(currentSession > 1);

        // Tokens can only be withdrawn from offerings by house 48h after the previous session has ended to account
        // for pending bets/game outcomes.
        require(house.getTime() >= (sessions[previousSession].endTime + 2 days));

        // Allow only if offering has not been withdrawn.
        require(!sessions[previousSession].withdrawnOfferings[houseOffering]);

        uint previousSessionTokens =
            offerings[houseOffering].houseOffering.balanceOf(houseOffering, previousSession);

        sessions[previousSession].withdrawnOfferings[houseOffering] = true;
        sessions[previousSession].withdrawCount += 1;

        return (
            previousSessionTokens,
            haveAllOfferingsBeenWithdrawn(previousSession)
        );
    }

    // Allocates a %age of tokens for a house offering for the next session
    function allocateTokensForHouseOffering(uint percentage, address houseOffering)
    public
    isValidHouseOffering(
        houseOffering,
        safeAdd(house.currentSession(), 1)
    )
    onlyHouse
    returns (bool) {
        uint nextSession = house.currentSession() + 1;

        // Can not allocate if allocation has been finalized
        require(!sessions[nextSession].finalizedTokenAllocations);

        // Total %age of tokens can't be above 100.
        require(safeAdd(sessions[nextSession].totalTokensAllocated, percentage) <= 100);

        // Tokens have already been deposited to offering.
        require(!sessions[nextSession].offeringDetails[houseOffering].deposited);

        uint previousAllocation =
            sessions[nextSession].offeringDetails[houseOffering].allocation;
        sessions[nextSession].offeringDetails[houseOffering].allocation =
            percentage;
        sessions[nextSession].totalTokensAllocated =
            safeSub(safeAdd(sessions[nextSession].totalTokensAllocated, percentage), previousAllocation);

        return true;
    }

    // Finalizes token allocation for the next session after allocating to all offerings
    function finalizeTokenAllocations()
    public
    onlyHouse
    returns (bool) {
        uint nextSession = house.currentSession() + 1;

        // All offerings should be allocated tokens
        for(uint i = 0; i < sessions[nextSession].offerings.length; i++) {
            // If an offering has been deleted from the session, the address would be 0x0. Ignore them.
            if(sessions[nextSession].offerings[i] != 0x0)
                require(
                    sessions[nextSession].offeringDetails
                        [sessions[nextSession].offerings[i]].allocation > 0
                );
        }

        // Total tokens allocated must be 100%
        require(sessions[nextSession].totalTokensAllocated == 100);

        // Token allocation can not already be finalized
        require(!sessions[nextSession].finalizedTokenAllocations);

        sessions[nextSession].finalizedTokenAllocations = true;

        return true;
    }

    function depositAllocatedTokensToHouseOffering(address houseOffering)
    public
    isValidHouseOffering(
        houseOffering,
        safeAdd(house.currentSession(), 1)
    )
    onlyHouse
    returns (bool) {
        uint nextSession = house.currentSession() + 1;

        // Can not deposit if token allocation has not been finalized
        require(sessions[nextSession].finalizedTokenAllocations);

        // Tokens have already been deposited to offering.
        require(!sessions[nextSession].offeringDetails[houseOffering].deposited);

        sessions[nextSession].offeringDetails[houseOffering].deposited =
            true;
        sessions[nextSession].depositedAllocations =
            safeAdd(sessions[nextSession].depositedAllocations, 1);

        return true;
    }

    function emergencyWithdrawCurrentSessionTokensFromHouseOffering(address houseOffering)
    public
    isValidHouseOffering(
        houseOffering,
        house.currentSession()
    )
    onlyHouse
    returns (uint, bool) {
        uint currentSession = house.currentSession();
        uint sessionTokens =
            offerings[houseOffering].houseOffering.balanceOf(houseOffering, currentSession);

        sessions[currentSession].withdrawnOfferings[houseOffering] = true;
        sessions[currentSession].withdrawCount += 1;

        // All offerings have been withdrawn.
        bool allOfferingsWithdrawn =
            sessions[currentSession].withdrawCount == sessions[currentSession].offeringCount;

        return (sessionTokens, allOfferingsWithdrawn);
    }

    // Starts the next session.
    // Call this function once after setting up the house to begin the initial credit buying period.
    function beginNextSession(uint startTime, uint endTime, uint sessionZeroStartTime)
    public
    onlyHouse
    returns (bool) {
        uint currentSession = house.currentSession();

        if (currentSession == 0 && sessionZeroStartTime == 0) {
            sessions[currentSession].active = false;
            sessions[currentSession].startTime = startTime;
            sessions[currentSession].endTime = endTime;
        } else {
            uint previousSession = safeSub(currentSession, 1);
            // currentSession has been set to nextSession in House contract.
            sessions[previousSession].active = false;

            // For a session to be considered active, getTime() would need to be between startTime and endTime
            // AND session should be active.
            sessions[currentSession].active = true;
            sessions[currentSession].startTime = startTime;
            sessions[currentSession].endTime = endTime;

            // All offerings should have deposited allocated tokens before switching to next session.
            require(
                sessions[currentSession].depositedAllocations ==
                sessions[currentSession].offeringCount
            );
        }

        return true;
    }

    // Utility functions for front-end purposes.

    // Returns session start and end time.
    function getSessionTime(uint session)
    public
    view
    returns (uint, uint) {
        return (
            sessions[session].startTime,
            sessions[session].endTime
        );
    }

    // Returns whether a session is active.
    function isSessionActive(uint session)
    public
    view
    returns (bool) {
        return house.getTime() >= sessions[session].startTime &&
               house.getTime() <= sessions[session].endTime;
    }

    // Returns whether an offering exists.
    function doesOfferingExist(address _offering)
    public
    view
    returns (bool) {
        return offerings[_offering].exists;
    }

    // Returns an offering for a session.
    function getSessionOffering(uint session, uint index)
    public
    view
    returns (address offering) {
        return sessions[session].offerings[index];
    }

    function getSessionTimes(uint session)
    public
    view
    returns (uint, uint) {
        return (sessions[session].startTime, sessions[session].endTime);
    }

    // Returns offering token allocations and deposits.
    function getOfferingDetails(uint session, address _address)
    public
    view
    returns (uint, bool, bool) {
        return (
            sessions[session].offeringDetails[_address].allocation,
            sessions[session].offeringDetails[_address].deposited,
            sessions[session].offeringDetails[_address].addedToSession
        );
    }

    // Returns total tokens allocated to offering
    function areSessionTokenAllocationsFinalized(uint session)
    public
    view
    returns (bool) {
        return sessions[session].finalizedTokenAllocations;
    }

    function getSessionOfferingsLength(uint session)
    public
    view
    returns (uint) {
        return sessions[session].offeringCount;
    }

    function getOfferingAddressesLength()
    public
    view
    returns (uint) {
        return offeringAddresses.length;
    }

    function isOfferingWithdrawn(uint session, address offering)
    public
    view
    returns (bool) {
        return sessions[session].withdrawnOfferings[offering];
    }

    function haveAllOfferingsBeenWithdrawn(uint session)
    public
    view
    returns (bool) {
        return (
            sessions[session].withdrawCount ==
            sessions[session].offeringCount
        );
    }

}
