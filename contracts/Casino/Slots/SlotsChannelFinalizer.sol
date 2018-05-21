pragma solidity 0.4.21;


import "./SlotsImplementation.sol";
import "./SlotsChannelManager.sol";
import "./SlotsHelper.sol";

import "../../Libraries/SafeMath.sol";
import "../../Libraries/strings.sol";
import "../../Libraries/Utils.sol";

import "../../Kyc/KycManager.sol";

// Since the finalize function call requires a lot of gas and makes SlotsChannelManager
// un-deployable due to an OOG exception, we move it into a separate contract.
contract SlotsChannelFinalizer is SlotsImplementation, SafeMath, Utils {

    address public owner;

    // Length of each reel in characters
    uint constant REEL_LENGTH = 21;

    // Number of reels
    uint constant NUMBER_OF_REELS = 5;

    // Number of lines
    uint constant NUMBER_OF_LINES = 5;

    // Starting balance for the house
    uint constant CHANNEL_HOUSE_STARTING_BALANCE = 10000 ether;

    SlotsChannelManager slotsChannelManager;
    SlotsHelper slotsHelper;
    KycManager kycManager;

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    modifier isSlotsChannelManagerSet() {
        require(address(slotsChannelManager) != 0x0);
        _;
    }

    // Allows functions to execute only if the sender has been KYC verified.
    modifier isSenderKycVerified() {
        require(kycManager.isKYCVerified(msg.sender));
        _;
    }

    function SlotsChannelFinalizer(address _slotsHelper, address _kycManager)
    public {
        owner = msg.sender;
        require(_slotsHelper != 0x0);
        require(_kycManager != 0x0);
        slotsHelper = SlotsHelper(_slotsHelper);
        kycManager  = KycManager(_kycManager);
    }

    function setSlotsChannelManager(address _slotsChannelManager)
    onlyOwner
    public {
        slotsChannelManager = SlotsChannelManager(_slotsChannelManager);
    }

    // Check reel array for winning lines (Currently 5 lines)
    function getTotalSpinReward(Spin spin)
    private
    view
    returns (uint) {
        uint[5] memory reelArray = slotsHelper.convertReelToArray(spin.reel);
        //300k gas
        bool isValid = true;

        for (uint8 i = 0; i < NUMBER_OF_REELS; i++) {
            // Reel values can only be between 0 and 20
            if (reelArray[i] > 20) {
                isValid = false;
                break;
            }
        }
        require(isValid);

        return slotsHelper.getTotalReward(spin.betSize, reelArray);
    }

    // Checks the signature of a spin sent and verifies it's validity
    function checkSigPrivate(bytes32 id, Spin s)
    private
    view
    returns (bool) {
        bytes32 hash = keccak256(
            s.reelHash,
            s.reel,
            s.reelSeedHash,
            s.prevReelSeedHash,
            s.userHash,
            s.prevUserHash,
            uintToString(s.nonce),
            boolToString(s.turn),
            uintToString(s.userBalance),
            uintToString(s.houseBalance),
            uintToString(s.betSize)
        );
        address player = slotsChannelManager.getPlayer(id, s.turn);
        return player == ecrecover(hash, s.v, s.r, s.s);
    }

    function checkSpinHashes(Spin curr, Spin prior)
    private
    pure
    returns (bool) {
        // During a player's turn, the spin would have the reel hash and
        // seed hash which were sent from the server.

        // Previous reel seed needs to be hash of current reel seed
        if (toBytes32(prior.reelSeedHash, 0) != sha256(curr.prevReelSeedHash)) return false;

        // Current and last spin should report the same reel seed hashes
        if (!strCompare(curr.reelSeedHash, prior.reelSeedHash)) return false;

        // Previous user hash needs to be hash of current user hash
        if (toBytes32(prior.userHash, 0) != sha256(curr.userHash)) return false;

        // Current and last spins should report the same user hashes
        if (!strCompare(curr.userHash, prior.prevUserHash)) return false;

        return true;
    }

    // Verifies last two spins and returns their validity
    function checkPair(Spin curr, Spin prior)
    private
    view
    returns (bool) {
        // If Player's turn
        if (curr.turn == false) {

            // User submitted spin would need to be house spin nonce + 1
            if(curr.nonce != prior.nonce + 1) revert();

            // The last reel hash needs to be a hash of the last reel seed, user hash and reel
            // The random numbers don't need to verified on contract, only the reel rewards
            // Random numbers could be verified off-chain using the seed-random library using the
            // below hash as the seed
            if (!compareReelHashes(curr, prior)) return false;
            // 103k gas

            // Bet size can be only up to maximum number of lines
            if(!slotsHelper.isValidBetSize(prior.betSize)) return false;
            return true;
        }
        else {
            // During the house's turn, the spin would have the user hash sent by the player

            // 32k gas for all conditions
            if(curr.nonce != prior.nonce) revert();

            // Bet size can be only upto maximum number of lines
            if(!slotsHelper.isValidBetSize(curr.betSize)) return false;

            // Bet size needs to be determined by the user, not house
            if (curr.betSize != prior.betSize) return false;
            return true;
        }

    }

    // Compare reel hashes for spins
    function compareReelHashes(Spin curr, Spin prior)
    private
    pure
    returns (bool) {
        string memory hashSeed = (prior.reelSeedHash.toSlice()
        .concat(prior.reel.toSlice()));
        return toBytes32(prior.reelHash, 0) == sha256(hashSeed);
    }

    function isValidSpinNonces(Spin curr, Spin prior)
    private
    pure
    returns (bool) {
        require(curr.nonce > 0 && curr.nonce < 1000);

        if(curr.turn)
            // If house turn, spin nonce are equal
            require(curr.nonce == prior.nonce);
        else
            // If user turn, spin nonce is greater than
            require(curr.nonce == prior.nonce + 1);

        return true;
    }

    // Compares two spins and checks whether balances reflect user winnings
    // Works only for user turns
    function isAccurateBalances(Spin curr, Spin prior, uint totalSpinReward)
    private
    pure
    returns (bool) {
        if(curr.turn) {
            // House turn

            // User balance for this spin must be the last user balance + reward
            if (curr.userBalance !=
                safeSub(safeAdd(prior.userBalance, totalSpinReward), prior.betSize))
                return false;

            // House balance for this spin must be the last house balance - reward
            if (curr.houseBalance !=
                safeAdd(safeSub(prior.houseBalance, totalSpinReward), prior.betSize))
                return false;
        } else {
            // User turn

            // Both user and house balances should be equal for current and previous spins.
            if(curr.userBalance != prior.userBalance) return false;

            if(curr.houseBalance != prior.houseBalance) return false;
        }

        return true;
    }

    // A "lighter" finalize function that can only be submitted by the house, this allows the house to finalize games
    // at a lesser gas cost with the trade-off of lesser security.
    // If the house tries to cheat by posting an older nonce, the user can challenge this with the
    // finalize function below.
    function lightFinalize(
        bytes32 id,
        string houseHashes,
        string userHashes,
        uint nonce,
        uint[2] userBalance,
        uint[2] houseBalance,
        uint betSize,
        uint8[2] v,
        bytes32[2] r,
        bytes32[2] s
    )
    isSlotsChannelManagerSet
    public
    returns (bool) {
        // This can only be submitted by the house
        require(slotsChannelManager.getPlayer(id, true) == msg.sender);
        require(slotsChannelManager.isChannelActivated(id));

        bytes32 houseHash = keccak256(
            houseHashes,
            uintToString(nonce),
            "true",
            uintToString(userBalance[0]),
            uintToString(houseBalance[0]),
            uintToString(betSize)
        );
        require(
            slotsChannelManager.getPlayer(id, true) ==
            ecrecover(houseHash, v[0], r[0], s[0])
        );

        bytes32 userHash = keccak256(
            userHashes,
            uintToString(nonce),
            "false",
            uintToString(userBalance[1]),
            uintToString(houseBalance[1]),
            uintToString(betSize)
        );

        require(
            slotsChannelManager.getPlayer(id, false) ==
            ecrecover(userHash, v[1], r[1], s[1])
        );

        // Validate bet size
        require(slotsHelper.isValidBetSize(betSize));

        if (shouldFinalizeChannel(id, nonce, true))
            slotsChannelManager.setFinal(
                id,
                userBalance[0],
                houseBalance[0],
                nonce,
                true,
                true
            );

        return true;
    }


    // If finalize() is called for a 0 nonce, prior, priorR and priorS can be empty/0
    function finalize(
        bytes32 id,
        string _curr,
        string _prior,
        bytes32 currR,
        bytes32 currS,
        bytes32 priorR,
        bytes32 priorS
    )
    isSenderKycVerified
    isSlotsChannelManagerSet
    public
    returns (bool) {
        require(slotsChannelManager.isParticipant(id, msg.sender));
        require(slotsChannelManager.isChannelActivated(id));

        Spin memory curr = convertSpin(_curr);
        // 5.6k gas
        curr.r = currR;
        curr.s = currS;

        if(curr.nonce == 0)
            return finalizeZeroNonce(id, curr);
        else {
            Spin memory prior = convertSpin(_prior);
            // 5.6k gas
            prior.r = priorR;
            prior.s = priorS;

            uint totalSpinReward = getTotalSpinReward(prior);

            require(isValidSpinNonces(curr, prior));
            require(isAccurateBalances(curr, prior, totalSpinReward));

            // 26k gas
            require(checkSigPrivate(id, curr));
            require(checkSigPrivate(id, prior));

            // Checks if spin hashes are pre-images of previous hashes or are hashes in previous spins
            require(checkSpinHashes(curr, prior));

            // 5.6k gas
            require(checkPair(curr, prior));

            // Finalized
            if (shouldFinalizeChannel(id, curr.nonce, false))
                slotsChannelManager.setFinal(id, curr.userBalance, curr.houseBalance,
                    curr.nonce, curr.turn, false); // 86k gas

            return true;
        }
    }

    // Allow parties to close channels with 0 nonce
    function finalizeZeroNonce(bytes32 id, Spin spin)
    isSenderKycVerified
    isSlotsChannelManagerSet
    private
    returns (bool) {
        require(spin.nonce == 0);

        require(
            slotsChannelManager.isValidZeroNonceSpin(
                id,
                spin.reelHash,
                spin.userHash,
                spin.reelSeedHash,
                spin.userBalance
            )
        );
        require(spin.houseBalance == CHANNEL_HOUSE_STARTING_BALANCE);
        require(checkSigPrivate(id, spin));

        if (shouldFinalizeChannel(id, spin.nonce, false))
            slotsChannelManager.setFinal(id, spin.userBalance, spin.houseBalance,
                spin.nonce, spin.turn, false); // 86k gas

        return true;
    }

    function shouldFinalizeChannel(bytes32 id, uint nonce, bool lightFinalized)
    private
    view
    returns (bool) {
        bool finalized;
        bool isChannelLightFinalized;
        uint finalNonce;
        (
            finalized,
            isChannelLightFinalized,
            finalNonce
        ) = slotsChannelManager.getChannelFinalized(id);

        // If nonce == 0, the spin should be submitted when the channel has not yet been finalized.
        // If it already has, there wouldn't be any need to submit a 0-nonce spin since
        // the finalNonce would either already be 0 or greater than 0.

        // If a channel was finalized with isLightFinalized, it can replace the same spin nonce
        // if it wasn't light finalized
        return (
            !finalized ||
            nonce > finalNonce ||
            (nonce == finalNonce && (isChannelLightFinalized && !lightFinalized))
        );
    }

    function getParts(string _spin)
    private
    returns (string[14]) {
        var slice = _spin.toSlice();
        var delimiter = "/".toSlice();
        string[14] memory parts;
        for (uint i = 0; i < parts.length; i++) {
            parts[i] = slice.split(delimiter).toString();
        }
        return parts;
    }

    // Convert a bytes32 array to a Spin object
    // Need this to get around 16 local variable function limit
    function convertSpin(string _spin)
    private
    returns (Spin) {
        string[14] memory parts = getParts(_spin);
        Spin memory spin = Spin({
            reelHash : parts[0],
            reel : parts[1],
            reelSeedHash : parts[2],
            prevReelSeedHash : parts[3],
            userHash : parts[4],
            prevUserHash : parts[5],
            nonce : parseInt(parts[6]),
            turn : parseBool(parts[7]),
            userBalance : parseInt(parts[8]),
            houseBalance : parseInt(parts[9]),
            betSize : parseInt(parts[10]),
            v : (uint8)(parseInt(parts[11])),
            r : 0,
            s : 0
        });
        return spin;
    }

}
