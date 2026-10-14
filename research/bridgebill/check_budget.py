"""Check the published worksheet examples against ticket-by-ticket arithmetic."""

from decimal import Decimal, ROUND_CEILING


def surplus(tickets, price, other, minimum, share):
    receipts = tickets * price
    return receipts - max(minimum, share * receipts) - other


def break_even(price, other, minimum, share):
    assert price > 0 and other >= 0 and minimum >= 0 and 0 <= share < 1
    threshold = max((other + minimum) / price, other / ((1 - share) * price))
    return int(threshold.to_integral_value(rounding=ROUND_CEILING))


if __name__ == "__main__":
    price, minimum, share = map(Decimal, ("10", "93", "0.35"))
    for other, expected, scenario, expected_surplus in (
        (250, 39, 40, 10), (180, 28, 30, 15), (700, 108, 100, -50)
    ):
        result = break_even(price, Decimal(other), minimum, share)
        counted = next(n for n in range(201) if surplus(n, price, other, minimum, share) >= 0)
        assert result == counted == expected
        assert surplus(scenario, price, other, minimum, share) == expected_surplus
    assert surplus(35, price, 250, minimum, share) == Decimal("-22.50")
    print("Three worksheet examples passed, including percentage-fee and capacity branches.")
