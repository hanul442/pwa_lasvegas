# Every line the dealer can say. The id is the file name under public/voice/.
# A one-word line ends in '!' so the model lands the word cleanly instead of trailing off; it does
# not change the pitch. A (text, 'en-us') pair swaps in the American reading where the British
# vowel was hard to make out (checked by running the files back through Whisper).
ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
        'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
TENS = {20: 'twenty', 30: 'thirty'}
RED = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}


def words(n):
    if n < 20:
        return ONES[n]
    t, o = n // 10 * 10, n % 10
    return TENS[t] + (f'-{ONES[o]}' if o else '')


LINES = {
    # Tables
    'place-bets': 'Place your bets, please.',
    'no-more-bets': 'No more bets.',
    'you-win': 'You win.',
    'dealer-wins': 'Dealer wins.',
    'push': "That's a push.",
    # Blackjack
    'blackjack': 'Blackjack.',
    'bust': 'Bust!',
    'dealer-busts': 'Dealer busts.',
    'insurance': 'Insurance?',
    # Baccarat
    'player-wins': 'Player wins.',
    'banker-wins': 'Banker wins.',
    'tie': 'Tie!',
    # Hold'em
    'your-action': 'Your action.',
    'all-in': 'All in.',
    'raise': 'Raise!',
    'call': 'Call!',
    'check': 'Check!',
    'flop': 'The flop.',
    'turn': 'The turn.',
    'river': 'The river.',
    'hand-0': ('High card.', 'en-us'),
    'hand-1': 'One pair.',
    'hand-2': 'Two pair.',
    'hand-3': 'Three of a kind.',
    'hand-4': 'Straight.',
    'hand-5': 'A flush.',
    'hand-6': 'Full house.',
    'hand-7': 'Four of a kind.',
    'hand-8': 'Straight flush.',
    'royal-flush': 'Royal flush.',
    # 맞고 and 섯다 call the same English words Korean tables already use.
    'your-turn': 'Your turn.',
    'stop': 'Stop!',
    'half': 'Half!',
    'die': 'Die!',
}
for n in range(1, 6):
    LINES[f'go-{n}'] = f'{ONES[n].capitalize()} go.'
for n in range(37):
    LINES[f'roulette-{n}'] = 'Zero, green.' if n == 0 else f"{words(n).capitalize()}, {'red' if n in RED else 'black'}."
for n in range(4, 18):
    LINES[f'sicbo-{n}'] = f"{words(n).capitalize()}. {'Small' if n <= 10 else 'Big'}."
PLURAL = ['', 'ones', 'twos', 'threes', 'fours', 'fives', 'sixes']
for n in range(1, 7):
    LINES[f'triple-{n}'] = (f'Triple {PLURAL[n]}.', 'en-us')
LINES['roulette-6'] = 'Six. Black.'  # with a comma the S came out voiced ("zix")

# Pieces the player strings together for bet amounts: "Raise to" + "two" "hundred" "fifty" "thousand".
# Each number word comes twice, mid-phrase (held, rising) and phrase-final (falling), so the
# joined phrase still lands like one sentence. Rendered tight, with no tail of silence.
PIECES = {
    'lead-call': 'Call,',
    'lead-raise': 'Raise to',
    'lead-bet': 'The bet is',
    'lead-all-in': 'All in,',
}
NUMBER_WORDS = ONES[1:] + ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
                           'hundred', 'thousand', 'million', 'billion', 'trillion']
for word in NUMBER_WORDS:
    PIECES[f'n-{word}'] = f'{word},'
    PIECES[f'n-{word}-end'] = f'{word}.'

# The dealer's thanks for a tip (뽀찌, public/js/toke.js), one picked at random.
LINES['tip-1'] = 'Thank you, sir.'
LINES['tip-2'] = 'Much appreciated.'
LINES['tip-3'] = 'Thank you kindly.'
LINES['tip-4'] = 'For the dealers. Thank you.'
