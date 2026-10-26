from pydantic import BaseModel, Field
from typing import Optional, Literal

class StrictRequest(BaseModel):
    model_config = {'extra': 'forbid'}

class PasswordChange(StrictRequest):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)

class PasswordSetup(StrictRequest):
    token: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)

class Reauthenticate(StrictRequest):
    password: str = Field(min_length=1, max_length=128)
    purpose: Literal['create_user','update_user','invitation','password_reset','revoke_sessions','change_login','access_state','revoke_others','update_role']
    target_user_id: Optional[int] = Field(None, gt=0)

class Confirmation(StrictRequest):
    reauth_token: str = Field(min_length=1, max_length=128)

class ReasonConfirmation(Confirmation):
    reason: str = Field(min_length=1, max_length=256)

class LoginChange(ReasonConfirmation):
    login: str = Field(min_length=3, max_length=254)

class AccessChange(ReasonConfirmation):
    is_active: bool
