"""Explicit search-only configuration; never loads environment files."""
from dataclasses import dataclass
from datetime import date, time

@dataclass(frozen=True)
class KTXAConfig:
    ktxa_origin: str
    ktxa_dest: str
    ktxa_date: date
    hour: int
    adults: int
    ktxa_include_srt: bool = False
    ktxa_train_type: str = "KTX"
    ktxa_tolerance_min: int = 0

    @property
    def ktxa_time_window(self):
        return (time(self.hour), time(23, 59))

    @property
    def ktxa_times(self):
        return [time(self.hour)]

    def passenger_counts(self):
        return {"어른": self.adults}
