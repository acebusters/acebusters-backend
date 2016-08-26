const ethUtil = require('ethereumjs-util');

var TableManager = function(db) {
  this.db = db; 
}

TableManager.prototype.pay = function(tableAddr, handId, receipt) {
  //check if this hand exists
    //if no
      //check if last hand completed
        //if no, exit
      //get lineup from contract (what is big and small blind?)
      //check if receipt is big blind?
        //if yes
          //check that it is players turn to pay big blind
          //create game and safe big blind
          //sign big blind and return to player
        //if no, exit
    //if yes
      //check next hand not started
      //check if this hand big blind payed
      //check if this hand small blind not payed
      //check that it is players turn to pay small blind
      //create and shuffle deck once small blind payed
      //sign small blind and return to player
}

TableManager.prototype.deal = function(tableAddr, handId, receipt) {
  //check that next hand not exists
  //get this hand (and lineup)
    //check that signer in lineup
    //check that all blinds payed
    //check player has enough balanace to participate
    //check it is signer's turn to fetch cards
    //deal cards to player
}

TableManager.prototype.flop = function(tableAddr, handId, receipts) {
  //check that it is the right hand to play
  //check that betting 1 completed
  //publish flop card
}

TableManager.prototype.turn = function(tableAddr, handId, receipts) {
  //check that it is the right hand to play
  //check that betting 2 completed
  //publish turn card
}

TableManager.prototype.river = function(tableAddr, handId, receipts) {
  //check that it is the right hand to play
  //check that betting 3 completed
  //publish river card
}

TableManager.prototype.show = function(tableAddr, handId, receipts, cards) {
  //check that it is the right hand to play
  //check that betting 4 completed
  //check that cards match
  //publish distribution
}


module.exports = TableManager;