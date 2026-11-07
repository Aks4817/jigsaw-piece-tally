// Observes the game's Photon wrapper without changing what it does.
//
// Photon doesn't send a player's own property writes back to them, so we need
// both directions: outgoing batches for our joins, incoming for everyone else's.
// Both functions are looked up on the object at call time by the game, so
// wrapping them here takes effect. Our handlers run first and can never throw
// into the game.
(function (root) {
  'use strict';

  const hooked = new WeakSet();

  function safely(fn, value, onError) {
    try {
      fn(value);
    } catch (error) {
      if (onError) onError(error);
    }
  }

  // Returns true once hooked. Returns false if the game isn't ready yet: the
  // multiplayer module assigns onPropertyChange during its init.
  function installHooks(photon, handlers) {
    if (!photon) return false;
    if (hooked.has(photon)) return true;
    const originalIncoming = photon.onPropertyChange;
    const originalOutgoing = photon.changeProperties;
    if (typeof originalIncoming !== 'function' || typeof originalOutgoing !== 'function') {
      return false;
    }

    photon.onPropertyChange = function (props, isSnapshot) {
      // The game passes a truthy second argument when replaying the whole room
      // state on join. Those records don't tell us who made each join.
      const handler = isSnapshot ? handlers.onSnapshot : handlers.onRemote;
      safely(handler, props, handlers.onError);
      return originalIncoming.apply(this, arguments);
    };

    photon.changeProperties = function (props) {
      // The game replaces this batch right after the call, so read it now.
      safely(handlers.onLocal, props, handlers.onError);
      return originalOutgoing.apply(this, arguments);
    };

    hooked.add(photon);
    return true;
  }

  root.__jigsawTally = Object.assign(root.__jigsawTally || {}, { installHooks });
  if (typeof module !== 'undefined' && module.exports) module.exports = { installHooks };
})(globalThis);
