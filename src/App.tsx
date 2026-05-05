/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Bomb as BombIcon, 
  User, 
  Trophy, 
  Zap, 
  Flame, 
  RotateCcw,
  Skull,
  Play,
  Users,
  Plus,
  LogIn,
  Crown,
  ChevronRight,
  LogOut,
  Sparkles
} from 'lucide-react';
import { 
  Position, 
  Bomb, 
  RemotePlayer,
  RoomData,
  GRID_WIDTH, 
  GRID_HEIGHT,
  TILE_SIZE
} from './types';
import { 
  auth, 
  db, 
  loginWithGoogle, 
  handleFirestoreError, 
  OperationType 
} from './lib/firebase';
import { 
  onSnapshot, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  collection, 
  serverTimestamp, 
} from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser, signOut } from 'firebase/auth';
import { soundService } from './services/soundService';

// Constants
const INITIAL_BOMBS = 1;
const INITIAL_FLAME = 1;
const BOMB_TIMER = 3000;

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [room, setRoom] = useState<RoomData | null>(null);
  const [players, setPlayers] = useState<RemotePlayer[]>([]);
  const [bombs, setBombs] = useState<Bomb[]>([]);
  const [explosions, setExplosions] = useState<{pos: Position, id: string}[]>([]);

  const [winner, setWinner] = useState<RemotePlayer | null>(null);

  // Refs to avoid stale closures in listeners
  const playersRef = React.useRef<RemotePlayer[]>([]);
  const roomRef = React.useRef<RoomData | null>(null);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  // Victory Check Effect
  useEffect(() => {
    if (room?.status === 'playing' && players.length > 1) {
      const alivePlayers = players.filter(p => p.isAlive);
      
      if (alivePlayers.length === 1) {
        // We have a winner!
        setWinner(alivePlayers[0]);
        if (alivePlayers[0].uid === user?.uid) {
          soundService.playVictory();
        }
        if (user?.uid === room.createdBy) {
          // Delay results slightly for dramatic effect
          setTimeout(() => {
            updateDoc(doc(db, 'rooms', room.id), { status: 'results' });
          }, 1000);
        }
      } else if (alivePlayers.length === 0) {
        // Draw (everyone died)
        setWinner(null);
        if (user?.uid === room.createdBy) {
          setTimeout(() => {
            updateDoc(doc(db, 'rooms', room.id), { status: 'results' });
          }, 1000);
        }
      }
    } else if (room?.status === 'results') {
      // Find the winner from the player list when results are shown
      const alive = players.find(p => p.isAlive);
      if (alive) setWinner(alive);
    }
  }, [players, room?.status, room?.id, room?.createdBy, user?.uid]);

  // Auth Listener
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const createRoom = async () => {
    if (!user) return;
    const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
    
    // Choose a random map style (Classical, Wide, or Open)
    const mapStyle = Math.random(); 
    
    const grid: string[] = [];
    for (let y = 0; y < GRID_HEIGHT; y++) {
      let row = "";
      for (let x = 0; x < GRID_WIDTH; x++) {
        // Border Walls
        if (x === 0 || x === GRID_WIDTH - 1 || y === 0 || y === GRID_HEIGHT - 1) {
          row += "W";
          continue;
        }

        // Hard internal walls based on style
        let isHardWall = false;
        if (mapStyle < 0.45) {
          // Classic Grid (Every 2nd tile)
          if (x % 2 === 0 && y % 2 === 0) isHardWall = true;
        } else if (mapStyle < 0.8) {
          // Wide Layout (Every 3rd tile)
          if (x % 3 === 0 && y % 3 === 0) isHardWall = true;
        } else if (mapStyle < 0.95) {
          // Corridors
          if (y % 2 === 0 && x % 4 === 0) isHardWall = true;
        }
        // mapStyle >= 0.95: Open Map (No internal hard walls)

        if (isHardWall) {
          row += "W";
        } else {
          // Corner Safe Zones
          const isSafe = 
            (x <= 2 && y <= 2) || 
            (x >= GRID_WIDTH - 3 && y >= GRID_HEIGHT - 3) ||
            (x >= GRID_WIDTH - 3 && y <= 2) ||
            (x <= 2 && y >= GRID_HEIGHT - 3);
            
          if (isSafe) {
            row += "E";
          } else {
            // Destructible Bricks
            const brickThreshold = mapStyle < 0.45 ? 0.4 : 0.6;
            row += Math.random() > brickThreshold ? "B" : "E";
          }
        }
      }
      grid.push(row);
    }

    const roomData: RoomData = {
      id: roomId,
      status: 'lobby',
      grid,
      createdBy: user.uid,
      level: 1
    };

    try {
      await setDoc(doc(db, 'rooms', roomId), {
        ...roomData,
        createdAt: serverTimestamp()
      });
      joinRoom(roomId);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `rooms/${roomId}`);
    }
  };

  const joinRoom = async (roomId: string) => {
    if (!user) return;
    
    // Assign corner based on UID hash for robust distribution
    const corners = [
      { x: 1, y: 1 }, // Top Left
      { x: GRID_WIDTH - 2, y: GRID_HEIGHT - 2 }, // Bottom Right
      { x: GRID_WIDTH - 2, y: 1 }, // Top Right
      { x: 1, y: GRID_HEIGHT - 2 } // Bottom Left
    ];
    const uidSum = user.uid.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const startPos = corners[uidSum % 4];

    const playerRef = doc(db, `rooms/${roomId}/players`, user.uid);

    try {
      await setDoc(playerRef, {
        uid: user.uid,
        displayName: user.displayName || 'Bomber',
        pos: startPos,
        color: `hsl(${Math.random() * 360}, 70%, 50%)`,
        isAlive: true,
        score: 0,
        bombsMax: INITIAL_BOMBS,
        flameRange: INITIAL_FLAME,
        isReady: false,
        lastMoveAt: serverTimestamp()
      });

      // Just trigger room state which will trigger the listener effect
      setRoom({ id: roomId, status: 'lobby', grid: [] } as any);

    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `rooms/${roomId}/players`);
    }
  };

  // Centralized Listeners
  useEffect(() => {
    if (!room?.id || !user) return;

    const roomId = room.id;

    const unsubscribeRoom = onSnapshot(doc(db, 'rooms', roomId), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as RoomData;
        setRoom(data);
      }
    }, (e) => handleFirestoreError(e, OperationType.GET, `rooms/${roomId}`));

    const unsubscribePlayers = onSnapshot(collection(db, `rooms/${roomId}/players`), (snap) => {
      const pList: RemotePlayer[] = [];
      snap.forEach(d => pList.push(d.data() as RemotePlayer));
      setPlayers(pList);
    }, (e) => handleFirestoreError(e, OperationType.GET, `rooms/${roomId}/players`));

    const unsubscribeBombs = onSnapshot(collection(db, `rooms/${roomId}/bombs`), (snap) => {
      const bList: Bomb[] = [];
      snap.forEach(d => {
        const data = d.data() as Bomb;
        bList.push(data);
      });
      setBombs(bList);
      
      snap.docChanges().forEach(change => {
        if (change.type === 'removed') {
          const explodedBomb = change.doc.data() as Bomb;
          // Capture latest players and grid from the shared refs which are now updated synchronously or via state
          // Actually, let's use a more direct approach
          triggerLocalExplosion(explodedBomb);
        }
      });
    }, (e) => handleFirestoreError(e, OperationType.GET, `rooms/${roomId}/bombs`));

    return () => {
      unsubscribeRoom();
      unsubscribePlayers();
      unsubscribeBombs();
    };
  }, [room?.id, user?.uid]);

  const triggerLocalExplosion = (bomb: Bomb) => {
    // We want to use the absolute latest data available.
    // Instead of relying on refs that update after render, we can't easily get the "new" players 
    // from the bombs snapshot. But we can check if the current user died by looking at their 
    // own known position.
    
    const affected: Position[] = [bomb.pos];
    const directions = [{x:1,y:0}, {x:-1,y:0}, {x:0,y:1}, {x:0,y:-1}];
    
    // We still use the ref for the room/players, but we must be careful.
    // To be safer, we'll use the state version but inside a closure-safe way if possible.
    // Actually, triggerLocalExplosion is recreated on every render, so if we use it 
    // inside useEffect with dependencies, it should be fine.
    
    const currentRoom = roomRef.current;
    if (!currentRoom) return;

    directions.forEach(dir => {
      for (let i = 1; i <= bomb.range; i++) {
        const px = bomb.pos.x + dir.x * i;
        const py = bomb.pos.y + dir.y * i;
        if (px < 0 || px >= GRID_WIDTH || py < 0 || py >= GRID_HEIGHT) break;
        
        const tile = currentRoom.grid[py][px];
        if (tile === 'W') break;
        affected.push({ x: px, y: py });
        if (tile === 'B') break;
      }
    });

    const explosionId = Math.random().toString();
    const explosionBatch = affected.map(p => ({ pos: p, id: `${explosionId}-${p.x}-${p.y}` }));
    setExplosions(prev => [...prev, ...explosionBatch]);
    soundService.playExplosion();
    setTimeout(() => setExplosions(prev => prev.filter(e => !explosionBatch.some(eb => eb.id === e.id))), 500);

    // Check my death using current player list
    const currentPlayers = playersRef.current;
    if (user) {
      const me = currentPlayers.find(p => p.uid === user.uid);
      if (me && me.isAlive && affected.some(ap => ap.x === me.pos.x && ap.y === me.pos.y)) {
        soundService.playGameOver();
        updateDoc(doc(db, `rooms/${currentRoom.id}/players`, user.uid), { isAlive: false });
      }
    }
  };

  const leaveRoom = async () => {
    if (!room || !user) return;
    try {
      await deleteDoc(doc(db, `rooms/${room.id}/players`, user.uid));
      setRoom(null);
      setPlayers([]);
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `rooms/${room.id}/players/${user.uid}`);
    }
  };

  const startGame = async () => {
    if (!room || !user || room.createdBy !== user.uid) return;
    try {
      await updateDoc(doc(db, 'rooms', room.id), { status: 'playing' });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `rooms/${room.id}`);
    }
  };

  const movePlayer = useCallback(async (dx: number, dy: number) => {
    if (!room || !user || room.status !== 'playing') return;
    const me = players.find(p => p.uid === user.uid);
    if (!me || !me.isAlive) return;

    const nextX = me.pos.x + dx;
    const nextY = me.pos.y + dy;

    if (nextX < 0 || nextX >= GRID_WIDTH || nextY < 0 || nextY >= GRID_HEIGHT) return;
    const row = room.grid[nextY];
    if (row[nextX] !== 'E') return;
    if (bombs.some(b => b.pos.x === nextX && b.pos.y === nextY)) return;

    try {
      await updateDoc(doc(db, `rooms/${room.id}/players`, user.uid), {
        pos: { x: nextX, y: nextY },
        lastMoveAt: serverTimestamp()
      });
      soundService.playMove();
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `rooms/${room.id}/players/${user.uid}`);
    }
  }, [room, user, players, bombs]);

  const placeBomb = useCallback(async () => {
    if (!room || !user || room.status !== 'playing') return;
    const me = players.find(p => p.uid === user.uid);
    const myBombs = bombs.filter(b => b.ownerId === user.uid);
    if (!me || !me.isAlive || myBombs.length >= me.bombsMax) return;

    if (bombs.some(b => b.pos.x === me.pos.x && b.pos.y === me.pos.y)) return;

    const bombId = Math.random().toString(36).substr(2, 9);
    const bombData = {
      id: bombId,
      pos: { ...me.pos },
      range: me.flameRange,
      ownerId: user.uid,
      createdAt: serverTimestamp()
    };

    try {
      await setDoc(doc(db, `rooms/${room.id}/bombs`, bombId), bombData);
      soundService.playPlaceBomb();
      setTimeout(() => checkAndKillGrid(room.id, bombData.pos, bombData.range, bombId), BOMB_TIMER);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `rooms/${room.id}/bombs/${bombId}`);
    }
  }, [room, user, players, bombs]);

  const checkAndKillGrid = async (roomId: string, pos: Position, range: number, bombId: string) => {
    // Only the bomb owner handles the GRID sync
    if (!room) return;
    try {
      const directions = [{x:1,y:0}, {x:-1,y:0}, {x:0,y:1}, {x:0,y:-1}];
      const newGrid = [...room.grid];
      let gridChanged = false;

      directions.forEach(dir => {
        for (let i = 1; i <= range; i++) {
          const px = pos.x + dir.x * i;
          const py = pos.y + dir.y * i;
          if (px < 0 || px >= GRID_WIDTH || py < 0 || py >= GRID_HEIGHT) break;
          const tile = newGrid[py][px];
          if (tile === 'W') break;
          if (tile === 'B') {
            const rowArr = newGrid[py].split('');
            rowArr[px] = 'E';
            newGrid[py] = rowArr.join('');
            gridChanged = true;
            break;
          }
        }
      });

      if (gridChanged) {
        await updateDoc(doc(db, 'rooms', roomId), { grid: newGrid });
      }
      
      // Deleting the bomb triggers triggerLocalExplosion for everyone
      await deleteDoc(doc(db, `rooms/${roomId}/bombs`, bombId));
    } catch (e) {}
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!room || room.status !== 'playing') return;
      switch (e.key) {
        case 'ArrowUp': case 'w': movePlayer(0, -1); break;
        case 'ArrowDown': case 's': movePlayer(0, 1); break;
        case 'ArrowLeft': case 'a': movePlayer(-1, 0); break;
        case 'ArrowRight': case 'd': movePlayer(1, 0); break;
        case ' ': placeBomb(); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [room, movePlayer, placeBomb]);

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Sparkles className="w-8 h-8 text-blue-500 animate-spin" /></div>;

  if (!user) {
    return (
      <div 
        className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-950 relative overflow-hidden"
        style={{
          backgroundImage: `linear-gradient(rgba(2, 6, 23, 0.8), rgba(2, 6, 23, 0.8)), url('https://cdn.phototourl.com/free/2026-05-05-571734ab-2328-4ed2-a8ae-96929c4ea3a1.png')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed'
        }}
      >
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-slate-900 p-12 rounded-[3.5rem] border border-slate-800 shadow-2xl shadow-blue-500/5 flex flex-col items-center gap-8 max-w-sm w-full text-center"
        >
          <div className="w-24 h-24 bg-blue-600 rounded-[2rem] flex items-center justify-center shadow-2xl shadow-blue-600/20">
            <BombIcon className="w-12 h-12 text-white" />
          </div>
          <div>
            <h1 className="text-4xl font-black mb-3 tracking-tighter">BOMB MASTER MONAD</h1>
            <p className="text-slate-400 font-medium leading-relaxed">Play with friends in real-time and avoid explosions!</p>
          </div>
          <button 
            onClick={loginWithGoogle}
            className="w-full h-14 bg-white text-slate-900 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-slate-100 transition-all active:scale-95 shadow-lg"
          >
            <LogIn className="w-5 h-5" />
            <span>Sign in with Google</span>
          </button>
        </motion.div>
      </div>
    );
  }

  if (!room) {
    return (
      <div 
        className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-950 relative overflow-hidden"
        style={{
          backgroundImage: `linear-gradient(rgba(2, 6, 23, 0.8), rgba(2, 6, 23, 0.8)), url('https://cdn.phototourl.com/free/2026-05-05-571734ab-2328-4ed2-a8ae-96929c4ea3a1.png')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed'
        }}
      >
        <div className="w-full max-w-3xl">
          <div className="flex items-center justify-between mb-12">
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 rounded-2xl overflow-hidden border-2 border-slate-800 ring-2 ring-blue-500/20">
                <img src={user.photoURL || ''} alt="avatar" className="w-full h-full object-cover" />
              </div>
              <div>
                <h2 className="text-2xl font-black leading-tight tracking-tight">{user.displayName}</h2>
                <div className="flex items-center gap-2 text-slate-500 text-sm font-semibold">
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                  Online Now
                </div>
              </div>
            </div>
            <button onClick={() => signOut(auth)} className="p-4 bg-slate-900 hover:bg-slate-800 rounded-2xl text-slate-500 hover:text-white transition-all shadow-xl">
              <LogOut className="w-5 h-5" />
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <motion.button 
              whileHover={{ y: -5 }}
              onClick={createRoom}
              className="group p-10 bg-blue-600 hover:bg-blue-500 rounded-[2.5rem] flex flex-col items-center gap-6 transition-all shadow-2xl shadow-blue-600/20 text-white"
            >
              <div className="w-20 h-20 bg-white/10 rounded-3xl flex items-center justify-center backdrop-blur-xl border border-white/20">
                <Plus className="w-10 h-10" />
              </div>
              <div className="text-center">
                <h3 className="text-3xl font-black mb-2 tracking-tight">Create Room</h3>
                <p className="text-blue-100/60 font-medium">Lead the pack and invite friends</p>
              </div>
            </motion.button>

            <motion.div 
              whileHover={{ y: -5 }}
              className="p-10 bg-slate-900 border border-slate-800 rounded-[2.5rem] flex flex-col gap-8 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-black tracking-tight">Join with Code</h3>
                <Users className="w-6 h-6 text-slate-700" />
              </div>
              <div className="space-y-4">
                <input 
                  id="room-code-input"
                  type="text" 
                  placeholder="CODE123"
                  className="w-full h-16 bg-slate-800/50 border-2 border-slate-800 focus:border-blue-600 rounded-2xl px-6 font-black tracking-[0.3em] text-xl outline-none transition-all placeholder:text-slate-700 uppercase"
                  onKeyUp={(e) => {
                    if (e.key === 'Enter') joinRoom((e.target as HTMLInputElement).value.toUpperCase());
                  }}
                />
                <button 
                  onClick={() => {
                    const input = document.getElementById('room-code-input') as HTMLInputElement;
                    joinRoom(input.value.toUpperCase());
                  }}
                  className="w-full h-14 bg-white text-slate-900 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-100 transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                  <span>Enter Lobby</span>
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-950 relative overflow-hidden"
      style={{
        backgroundImage: `linear-gradient(rgba(2, 6, 23, 0.85), rgba(2, 6, 23, 0.85)), url('https://cdn.phototourl.com/free/2026-05-05-571734ab-2328-4ed2-a8ae-96929c4ea3a1.png')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed'
      }}
    >
      {room.status === 'lobby' ? (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900 p-10 rounded-[3.5rem] border border-slate-800 shadow-[0_0_80px_rgba(37,99,235,0.05)] max-w-xl w-full"
        >
          <div className="flex items-center justify-between mb-10 pb-8 border-b border-slate-800/50">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                <span className="text-[11px] text-blue-500 font-black uppercase tracking-[0.2em]">Game Lobby</span>
              </div>
              <div className="flex items-center gap-4">
                <h1 className="text-5xl font-black tracking-tighter text-white">{room.id}</h1>
                <button 
                  onClick={leaveRoom}
                  className="p-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-400 hover:text-white transition-all shadow-lg border border-slate-700/50 group"
                  title="Leave Room"
                >
                  <RotateCcw className="w-5 h-5 group-hover:-rotate-180 transition-transform duration-500" />
                </button>
              </div>
            </div>
            {room.createdBy === user.uid && players.length > 1 && (
              <button 
                onClick={startGame}
                className="bg-blue-600 hover:bg-blue-500 text-white py-4 px-10 rounded-2xl font-bold flex items-center gap-2 shadow-2xl shadow-blue-600/20 transition-all active:scale-95"
              >
                <Play className="w-5 h-5 fill-current" />
                <span>Start Game</span>
              </button>
            )}
          </div>

          <div className="space-y-6">
            <h3 className="text-slate-600 font-bold uppercase text-[10px] tracking-[0.3em] ml-1">Players Online ({players.length})</h3>
            <div className="grid gap-4">
              {players.map(p => (
                <motion.div 
                  layout
                  key={p.uid} 
                  className="bg-slate-800/30 p-5 rounded-2xl border border-slate-800 flex items-center justify-between group hover:bg-slate-800/50 transition-colors"
                >
                  <div className="flex items-center gap-5">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg transform group-hover:rotate-12 transition-transform" style={{ background: p.color }}>
                      <User className="w-6 h-6 text-white" />
                    </div>
                    <span className="font-black text-xl tracking-tight">{p.displayName}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {p.uid === room.createdBy && <Crown className="w-5 h-5 text-yellow-500 drop-shadow-[0_0_8px_rgba(234,179,8,0.3)]" />}
                    {p.uid === user.uid && <span className="bg-blue-600/10 text-blue-500 text-[9px] font-black px-2 py-1 rounded-md uppercase tracking-wider">You</span>}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
          
          <p className="mt-12 text-slate-500 text-center font-semibold text-sm leading-relaxed">
            Send code <span className="text-white font-black px-2 py-1 bg-slate-850 rounded-lg select-all cursor-pointer">{room.id}</span> to friends to join the battle
          </p>
        </motion.div>
      ) : room.status === 'results' ? (
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-slate-900 p-12 rounded-[3.5rem] border border-slate-800 shadow-2xl flex flex-col items-center gap-8 max-w-md w-full text-center"
        >
          <div className="w-24 h-24 bg-yellow-500 rounded-[2rem] flex items-center justify-center shadow-2xl shadow-yellow-500/20">
            <Trophy className="w-12 h-12 text-white" />
          </div>
          <div>
            <h2 className="text-4xl font-black mb-2 tracking-tighter">Match Ended!</h2>
            {winner ? (
              <div className="mt-6">
                <p className="text-slate-400 font-bold mb-4">The Winner Is</p>
                <div className="bg-slate-800 p-6 rounded-3xl border border-slate-700 flex items-center justify-center gap-4">
                   <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: winner.color }}>
                      <User className="w-6 h-6 text-white" />
                   </div>
                   <span className="text-2xl font-black text-white">{winner.displayName}</span>
                </div>
              </div>
            ) : (
              <p className="text-slate-400 font-bold py-6">Draw! Nobody survived.</p>
            )}
          </div>
          
          <button 
            onClick={() => setRoom(null)}
            className="w-full h-14 bg-white text-slate-900 rounded-2xl font-black flex items-center justify-center gap-3 hover:bg-slate-100 transition-all active:scale-95 shadow-lg"
          >
            <RotateCcw className="w-5 h-5" />
            <span>Return to Menu</span>
          </button>
        </motion.div>
      ) : (
        <div className="flex flex-col items-center gap-8">
          <div className="w-full flex items-center justify-between bg-slate-900/40 backdrop-blur-3xl p-5 rounded-[2.5rem] border border-slate-800/50 gap-10 shadow-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-600/5 to-transparent pointer-events-none" />
            <div className="flex gap-10 items-center pl-6">
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em] mb-1">Alive</span>
                <span className="text-2xl font-black tracking-tight">{players.filter(p => p.isAlive).length} / {players.length}</span>
              </div>
              <div className="h-10 w-px bg-slate-800" />
              <div className="flex items-center -space-x-3">
                {players.map(p => (
                  <div 
                    key={p.uid} 
                    className={`w-10 h-10 rounded-xl flex items-center justify-center border-2 border-slate-950 shadow-2xl transition-all ${!p.isAlive ? 'opacity-20 grayscale scale-75' : 'hover:z-10 hover:scale-125'}`} 
                    style={{ background: p.color }}
                    title={p.displayName}
                  >
                    <User className="w-5 h-5 text-white" />
                  </div>
                ))}
              </div>
            </div>
            
            <button onClick={() => setRoom(null)} className="h-14 w-14 flex items-center justify-center bg-slate-950 text-slate-500 hover:text-white transition-all rounded-2xl border border-slate-800 hover:border-slate-700 shadow-xl group">
               <RotateCcw className="w-5 h-5 group-hover:rotate-180 transition-transform duration-500" />
            </button>
          </div>

          <div
            className="p-3 bg-slate-900 rounded-[2.5rem] border-[12px] border-slate-900 shadow-2xl relative overflow-hidden"
            style={{
              width: GRID_WIDTH * TILE_SIZE + 24,
              height: GRID_HEIGHT * TILE_SIZE + 24,
            }}
          >
            {/* Background Watermark */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
              <h1 className="text-[12rem] font-black text-white/[0.03] rotate-[-15deg] whitespace-nowrap tracking-tighter uppercase">
                Bomb Master Monad
              </h1>
            </div>

            {/* Grid Rendering */}
            {room?.grid?.map((row, y) => row.split('').map((tile, x) => (
              <div 
                key={`${x}-${y}`}
                className="absolute"
                style={{
                  left: x * TILE_SIZE,
                  top: y * TILE_SIZE,
                  width: TILE_SIZE,
                  height: TILE_SIZE,
                }}
              >
                {tile === 'W' && (
                  <div className="w-full h-full bg-[#1e293b] rounded-sm border-b-4 border-r-4 border-slate-950 flex items-center justify-center shadow-inner">
                    <div className="w-2.5 h-2.5 bg-slate-900/50 rounded-full" />
                  </div>
                )}
                {tile === 'B' && (
                  <motion.div 
                    initial={false}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    className="w-[85%] h-[85%] m-[7.5%] bg-blue-900 rounded-[6px] border-b-4 border-r-4 border-blue-950 shadow-xl"
                  />
                )}
              </div>
            )))}

             {/* Bombs */}
             {bombs?.map(bomb => (
              <motion.div
                key={bomb.id}
                animate={{ scale: [0.9, 1.1, 0.9], rotate: [-2, 2, -2] }}
                transition={{ repeat: Infinity, duration: 0.4 }}
                className="absolute z-20 flex items-center justify-center p-2"
                style={{
                  left: bomb.pos.x * TILE_SIZE,
                  top: bomb.pos.y * TILE_SIZE,
                  width: TILE_SIZE,
                  height: TILE_SIZE,
                }}
              >
                <div className="w-full h-full bg-slate-950 rounded-full flex items-center justify-center border-4 border-slate-800 shadow-2xl relative">
                  <BombIcon className="w-6 h-6 text-slate-500" />
                  <div className="absolute top-1 right-2 w-1.5 h-1.5 bg-red-500 rounded-full animate-ping" />
                </div>
              </motion.div>
            ))}

            {/* Explosions */}
            <AnimatePresence>
              {explosions?.map(exp => (
                <motion.div
                  key={exp.id}
                  initial={{ opacity: 0, scale: 0.1 }}
                  animate={{ opacity: 0.8, scale: 1.2 }}
                  exit={{ opacity: 0, scale: 1.5 }}
                  className="absolute z-30 bg-gradient-to-br from-orange-400 to-red-600 rounded-md blur-md shadow-[0_0_30px_#f97316]"
                  style={{
                    left: exp.pos.x * TILE_SIZE,
                    top: exp.pos.y * TILE_SIZE,
                    width: TILE_SIZE,
                    height: TILE_SIZE,
                  }}
                />
              ))}
            </AnimatePresence>

            {/* Players */}
            {players?.map(p => (
              <motion.div
                key={p.uid}
                initial={false}
                animate={{ 
                  x: p.pos.x * TILE_SIZE, 
                  y: p.pos.y * TILE_SIZE,
                  opacity: p.isAlive ? 1 : 0
                }}
                transition={{ type: 'spring', damping: 25, stiffness: 400 }}
                className="absolute z-40 flex items-center justify-center p-2"
                style={{
                  width: TILE_SIZE,
                  height: TILE_SIZE,
                }}
              >
                <div 
                  className="w-full h-full rounded-[10px] flex items-center justify-center shadow-2xl border-b-[6px] border-black/30 relative"
                  style={{ background: p.color }}
                >
                  <User className="w-5 h-5 text-white" />
                  {p.uid === user.uid && (
                    <motion.div 
                      layoutId="player-indicator"
                      className="absolute -top-10 bg-white text-slate-900 text-[10px] px-2.5 py-1 rounded-full font-black shadow-2xl whitespace-nowrap border-2 border-white pointer-events-none after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-4 after:border-transparent after:border-t-white"
                    >
                      You
                    </motion.div>
                  )}
                  <div className="absolute -bottom-10 whitespace-nowrap text-[9px] font-black text-slate-500 uppercase tracking-widest">{p.displayName}</div>
                </div>
              </motion.div>
            ))}

            {/* Game Over Screen */}
            <AnimatePresence>
              {room.status === 'playing' && players.find(p => p.uid === user.uid && !p.isAlive) && (
                <motion.div 
                  initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
                  animate={{ opacity: 1, backdropFilter: 'blur(8px)' }}
                  className="absolute inset-x-0 inset-y-0 z-50 bg-slate-950/60 flex flex-col items-center justify-center p-12 text-center rounded-[2rem]"
                >
                  <motion.div 
                    initial={{ scale: 0.5 }}
                    animate={{ scale: 1 }}
                    className="w-24 h-24 bg-red-500/10 rounded-[2rem] flex items-center justify-center mb-8 border border-red-500/20"
                  >
                    <Skull className="w-12 h-12 text-red-500" />
                  </motion.div>
                  <h2 className="text-5xl font-black text-white mb-3 uppercase tracking-tighter italic">GAME OVER</h2>
                  <p className="text-slate-400 font-bold mb-10 tracking-tight">You were caught in the blast! Sit tight or exit.</p>
                  <button onClick={() => setRoom(null)} className="bg-white text-slate-950 font-black py-4 px-12 rounded-2xl hover:bg-slate-100 transition-all active:scale-95 shadow-2xl">
                    Return to Menu
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          
          <div className="flex gap-10 items-center justify-center bg-slate-900/30 p-4 px-10 rounded-full border border-slate-800 backdrop-blur-xl">
             <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                   {['W','A','S','D'].map(key => <kbd key={key} className="w-8 h-8 flex items-center justify-center bg-slate-900 border border-slate-800 rounded-lg text-xs font-black text-slate-400">{key}</kbd>)}
                </div>
                <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest leading-none mt-1">Move Player</span>
             </div>
             <div className="w-px h-6 bg-slate-800" />
             <div className="flex items-center gap-3">
                <kbd className="h-8 px-4 flex items-center justify-center bg-slate-900 border border-slate-800 rounded-lg text-[10px] font-black text-slate-400 uppercase tracking-widest">Space</kbd>
                <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest leading-none mt-1">Plant Bomb</span>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
