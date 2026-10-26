import os
import sys
from pathlib import Path

os.environ['DATABASE_URL'] = 'sqlite://'
os.environ['RUN_STARTUP_SEED'] = 'false'
os.environ['RUN_STARTUP_MAINTENANCE'] = 'false'
os.environ['RUN_NOTIFICATION_SCHEDULER'] = 'false'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
