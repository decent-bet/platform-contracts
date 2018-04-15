pragma solidity ^0.4.0;

contract AbstractHouseLotteryController {

    /*
     * CALL FUNCTIONS
     */
    // Returns whether the contract is a house lottery controller
    function isHouseLotteryController() returns (bool isHouseLotteryController) {}
    // Returns the winning lottery ticket for a session
    function getWinningLotteryTicket(uint session) returns (uint winningTicket) {}
    // Returns the winning address for a lottery session
    function getLotteryWinner(uint session) returns (address winner) {}
    // Returns whether the lottery has been finalized for a session
    function isLotteryFinalized(uint session) returns (bool finalized) {}
    // Returns whether a lottery has been claimed for a session
    function isLotteryClaimed(uint session) returns (bool claimed) {}

    /*
     * STATE CHANGING FUNCTIONS
     */
    // Picks the winner for a session by sending a transaction to the oraclize contract
    function pickWinner(uint session) payable returns (bool sentTx) {}
    // Allots lottery tickets for a session for an address based on the token amount invested
    function allotLotteryTickets(uint session, address _address, uint tokenAmount) returns (bool alloted) {}
    // Updates the lottery payout for a session winning address
    function updateLotteryPayout(uint session, address _address, uint payout) returns (bool updated) {}

}
