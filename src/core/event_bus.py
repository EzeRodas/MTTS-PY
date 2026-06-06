import logging
from typing import Callable, Dict, List, Any
import threading

logger = logging.getLogger(__name__)

class EventBus:
    """
    A simple thread-safe Publish/Subscribe event bus.
    Used for decoupling backend components and notifying the UI of state changes.
    """
    def __init__(self):
        self._subscribers: Dict[str, List[Callable[[Any], None]]] = {}
        self._lock = threading.RLock()

    def subscribe(self, event_name: str, callback: Callable[[Any], None]):
        """Subscribe to an event by name."""
        with self._lock:
            if event_name not in self._subscribers:
                self._subscribers[event_name] = []
            if callback not in self._subscribers[event_name]:
                self._subscribers[event_name].append(callback)

    def unsubscribe(self, event_name: str, callback: Callable[[Any], None]):
        """Unsubscribe from an event by name."""
        with self._lock:
            if event_name in self._subscribers:
                try:
                    self._subscribers[event_name].remove(callback)
                except ValueError:
                    pass

    def emit(self, event_name: str, data: Any = None):
        """Emit an event to all subscribers."""
        with self._lock:
            # Copy the list to avoid issues if a subscriber unsubscribes during iteration
            callbacks = self._subscribers.get(event_name, []).copy()
            
        for cb in callbacks:
            try:
                cb(data)
            except Exception as e:
                logger.error(f"Error in EventBus subscriber for event '{event_name}': {e}")
