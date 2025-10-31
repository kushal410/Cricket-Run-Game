const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

let game = {
  started: false,
  players: {},
  round: [],
  joinTimer: null,
  drawTimer: null
};

const possibleRuns = [0,1,2,3,4,6];

function getAlivePlayers() {
  return Object.keys(game.players).filter(id => game.players[id].alive);
}

function getPublicPlayers() {
  return Object.keys(game.players).map(id => {
    const p = game.players[id];
    return { name: p.name, alive: p.alive };
  });
}

function autoDrawRemaining(){
  const alive = getAlivePlayers();
  alive.forEach(id => {
    if(!game.round.find(r => r.socketId === id)){
      const run = possibleRuns[Math.floor(Math.random()*possibleRuns.length)];
      const p = game.players[id];
      game.round.push({socketId:id, name:p.name, run});
      io.emit("message", `🏏 ${p.name} auto-scored ${run} run(s)`);
    }
  });
  endRound();
}

function endRound(){
  const loser = game.round.reduce((a,b)=>a.run<b.run?a:b);
  game.players[loser.socketId].alive=false;
  io.emit("message", `💀 ${loser.name} is out (scored ${loser.run} run(s))`);

  const remaining = Object.values(game.players).filter(p=>p.alive);
  if(remaining.length===1){
    io.emit("message", `🏆 Congratulations ${remaining[0].name}! You won the game!`);
    game.started=false;
  } else if(remaining.length===0){
    io.emit("message", "⚠️ No players left. Game ended.");
    game.started=false;
  } else {
    io.emit("message","➡️ Next round! Type !d to score runs within 30 seconds!");
    game.round=[];
    startDrawTimer();
  }

  io.emit("players", getPublicPlayers());
}

function startDrawTimer(){
  clearTimeout(game.drawTimer);
  let countdown = 30;
  const interval = setInterval(()=>{
    if(!game.started) return clearInterval(interval);
    if([10,5,3,1].includes(countdown)){
      io.emit("message", `⏱️ ${countdown} seconds left to draw!`);
    }
    countdown--;
    if(countdown<0){
      clearInterval(interval);
      autoDrawRemaining();
    }
  },1000);
  game.drawTimer = interval;
}

function startJoinTimer(){
  clearTimeout(game.joinTimer);
  let countdown = 30;
  const interval = setInterval(()=>{
    if(!game.started) return clearInterval(interval);
    if([10,5,3,1].includes(countdown)){
      io.emit("message", `⏱️ ${countdown} seconds left to join!`);
    }
    countdown--;
    if(countdown<0){
      clearInterval(interval);
      io.emit("message","✅ Join time ended. Round 1 begins! Type !d to score runs!");
      startDrawTimer();
    }
  },1000);
  game.joinTimer = interval;
}

io.on("connection", (socket)=>{
  console.log("👋 socket connected:", socket.id);
  socket.emit("message","Welcome! Please set a temporary username first.");

  socket.on("setName", (name)=>{
    name = String(name||"Guest").trim().slice(0,24) || "Guest";
    game.players[socket.id] = {name, alive:true};
    io.emit("message", `👤 ${name} joined the room.`);
    io.emit("players", getPublicPlayers());
  });

  socket.on("chat",(msg)=>{
    const user = game.players[socket.id];
    if(!user){
      socket.emit("message","⚠️ You must set a username first.");
      return;
    }
    msg = String(msg||"").trim();

    if(msg==="!start"){
      if(game.started){
        socket.emit("message","⚠️ Game already running.");
        return;
      }
      game.started = true;
      Object.keys(game.players).forEach(id=>game.players[id].alive=true);
      game.round = [];
      io.emit("message", `🏏 Game started by ${user.name}! Type !j to join within 30 seconds!`);
      startJoinTimer();
      io.emit("players", getPublicPlayers());
      return;
    }

    if(msg==="!j"){
      if(!game.started){
        socket.emit("message","⚠️ No game started. Type !start to begin.");
        return;
      }
      game.players[socket.id].alive=true;
      io.emit("message", `✅ ${user.name} joined the game.`);
      io.emit("players", getPublicPlayers());
      return;
    }

    if(msg==="!d"){
      if(!game.started){
        socket.emit("message","⚠️ No game running. Type !start to begin.");
        return;
      }
      const p = game.players[socket.id];
      if(!p.alive){
        socket.emit("message","❌ You are eliminated.");
        return;
      }
      if(game.round.find(r=>r.socketId===socket.id)){
        socket.emit("message","⚠️ You already scored this round.");
        return;
      }
      const run = possibleRuns[Math.floor(Math.random()*possibleRuns.length)];
      game.round.push({socketId:socket.id, name:p.name, run});
      io.emit("message", `🏏 ${p.name} scored ${run} run(s)`);

      if(game.round.length === getAlivePlayers().length){
        clearTimeout(game.drawTimer);
        endRound();
      }
      return;
    }

    io.emit("message", `${user.name}: ${msg}`);
  });

  socket.on("disconnect", ()=>{
    const p = game.players[socket.id];
    if(p){
      io.emit("message", `❌ ${p.name} disconnected.`);
      delete game.players[socket.id];
      io.emit("players", getPublicPlayers());
    }
    console.log("socket disconnected:", socket.id);
  });
});

server.listen(PORT,()=>console.log(`Server listening on port ${PORT}`));
