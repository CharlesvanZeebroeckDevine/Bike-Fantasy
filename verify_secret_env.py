import jwt
import os
from dotenv import load_dotenv

# Load envs from .env and .env.local
load_dotenv(".env")
load_dotenv(".env.local", override=True) # .env.local takes precedence usually in Vercel

secret = os.getenv("SUPABASE_JWT_SECRET") or os.getenv("MEGABIKE_JWT_SECRET")
anon_key = os.getenv("REACT_APP_SUPABASE_ANON_KEY")

print(f"DEBUG: Secret found: {secret[:5]}..." if secret else "DEBUG: Secret NOT found")
print(f"DEBUG: Anon Key found: {anon_key[:10]}..." if anon_key else "DEBUG: Anon Key NOT found")

if not secret or not anon_key:
    print("FAILURE: Missing secret or anon key in env files.")
    exit(1)

try:
    # Try to verify the anon key signature using the secret.
    # The anon key is signed with the project's JWT secret.
    # If the secret is correct, this verification will pass.
    decoded = jwt.decode(anon_key, secret, algorithms=["HS256"], options={"verify_exp": False})
    print("SUCCESS: Secret matches Anon Key. Configuration is CORRECT.")
except jwt.exceptions.InvalidSignatureError:
    print("FAILURE: Secret does NOT match Anon Key. The secret is wrong.")
except Exception as e:
    print(f"ERROR: {e}")
