/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum TileType {
  EMPTY = 'empty',
  WALL = 'wall',      
  BLOCK = 'block',    
}

export enum PowerUpType {
  SPEED = 'speed',
  FLAME = 'flame',
  BOMB = 'bomb',
}

export interface Position {
  x: number;
  y: number;
}

export interface Bomb {
  id: string;
  pos: Position;
  range: number;
  ownerId: string;
  createdAt?: any;
}

export interface Player {
  id: string;
  pos: Position;
  targetPos: Position;
  speed: number;
  bombCount: number;
  maxBombs: number;
  flameRange: number;
  isAlive: boolean;
  score: number;
  color: string;
}

export interface RemotePlayer {
  uid: string;
  displayName: string;
  pos: Position;
  color: string;
  isAlive: boolean;
  score: number;
  bombsMax: number;
  flameRange: number;
  isReady: boolean;
  lastMoveAt?: any;
}

export interface RoomData {
  id: string;
  status: 'lobby' | 'playing' | 'results';
  grid: string[]; 
  createdBy: string;
  level: number;
}

export const GRID_WIDTH = 15;
export const GRID_HEIGHT = 11;
export const TILE_SIZE = 40;
