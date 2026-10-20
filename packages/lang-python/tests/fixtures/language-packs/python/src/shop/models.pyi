from dataclasses import dataclass

@dataclass(frozen=True)
class Order:
    id: int
    status: str

    def total(self) -> float: ...
