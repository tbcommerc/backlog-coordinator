from datetime import date
from pydantic import BaseModel, ConfigDict, Field, model_validator


class TaskPlanUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    version: int = Field(ge=0)
    starts_on: date | None = None
    ends_on: date | None = None
    is_milestone: bool = False
    expected_result: str = Field('', max_length=4000)
    change_reason: str = Field('', max_length=2000)

    @model_validator(mode='after')
    def dates(self):
        if (self.starts_on is None) != (self.ends_on is None):
            raise ValueError('Укажите обе даты или очистите обе')
        if self.starts_on and (self.starts_on > self.ends_on or self.starts_on.year < 2000 or self.ends_on.year > 2099):
            raise ValueError('Проверьте порядок дат и диапазон 2000–2099')
        return self
